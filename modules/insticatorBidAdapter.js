import {config} from '../src/config.js';
import { BANNER, VIDEO } from '../src/mediaTypes.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
import {deepAccess, generateUUID, logError, isArray} from '../src/utils.js';
import {getStorageManager} from '../src/storageManager.js';
import find from 'core-js-pure/features/array/find.js';

const BIDDER_CODE = 'insticator';
const ENDPOINT = 'https://ex.ingage.tech/v1/openrtb'; // production endpoint
const USER_ID_KEY = 'instUid';
const USER_ID_COOKIE_EXP = 7776000000; // 90 days
const BID_TTL = 300; // 5 minutes
const GVLID = 910;

export const storage = getStorageManager(GVLID, BIDDER_CODE);

config.setDefaults({
  insticator: {
    endpointUrl: ENDPOINT,
    bidTTL: BID_TTL,
  },
});

function getUserId() {
  let uid = storage.getCookie(USER_ID_KEY);
  if (uid && isUserIdValid(uid)) {
    const expireIn = new Date(Date.now() + USER_ID_COOKIE_EXP).toUTCString();
    const domain = window.location.hostname.match(/[^.]*\.[^.]{2,3}(?:\.[^.]{2,3})?$/mg);
    storage.setCookie(USER_ID_KEY, uid, expireIn, 'none', `.${domain}`);
    return uid;
  }

  return generateUserId()
}

function isUserIdValid(uid) {
  return uid && uid.length === 36;
}

function generateUserId() {
  const uid = generateUUID();

  if (isCookieEnabled()) {
    const expireIn = new Date(Date.now() + USER_ID_COOKIE_EXP).toUTCString();
    const domain = window.location.hostname.match(/[^.]*\.[^.]{2,3}(?:\.[^.]{2,3})?$/mg);
    storage.setCookie(USER_ID_KEY, uid, expireIn, 'none', `.${domain}`);
  }

  return uid;
}

function isCookieEnabled() {
  let enabled = false;

  try {
    const expireIn = new Date(Date.now() + USER_ID_COOKIE_EXP).toUTCString();
    storage.setCookie('insticator.prebid.cookieTest', 'true', expireIn);
    enabled = Boolean(storage.getCookie('insticator.prebid.cookieTest'));
  } catch (err) {
    return false;
  } finally {
    if (enabled) {
      storage.setCookie('insticator.prebid.cookieTest', 'true', new Date(Date.now()).toUTCString());
    }
  }

  return enabled;
}

function buildBanner(bidRequest) {
  const format = [];
  const pos = deepAccess(bidRequest, 'mediaTypes.banner.pos');
  const sizes =
    deepAccess(bidRequest, 'mediaTypes.banner.sizes') || bidRequest.sizes;

  for (const size of sizes) {
    format.push({
      w: size[0],
      h: size[1],
    });
  }

  return {
    format,
    pos,
  }
}

function buildVideo(bidRequest) {
  const w = deepAccess(bidRequest, 'mediaTypes.video.w');
  const h = deepAccess(bidRequest, 'mediaTypes.video.h');
  const mimes = deepAccess(bidRequest, 'mediaTypes.video.mimes');
  const placement = deepAccess(bidRequest, 'mediaTypes.video.placement') || 3;

  return {
    placement,
    mimes,
    w,
    h,
  }
}

function buildImpression(bidRequest) {
  const imp = {
    id: bidRequest.bidId,
    tagid: bidRequest.adUnitCode,
    instl: deepAccess(bidRequest, 'ortb2Imp.instl'),
    secure: location.protocol === 'https:' ? 1 : 0,
    ext: {
      gpid: deepAccess(bidRequest, 'ortb2Imp.ext.gpid'),
      insticator: {
        adUnitId: bidRequest.params.adUnitId,
      },
    },
  }

  if (deepAccess(bidRequest, 'mediaTypes.banner')) {
    imp.banner = buildBanner(bidRequest);
  }

  if (deepAccess(bidRequest, 'mediaTypes.video')) {
    imp.video = buildVideo(bidRequest);
  }

  return imp;
}

function buildDevice() {
  const device = {
    w: window.innerWidth,
    h: window.innerHeight,
    js: true,
    ext: {},
  };

  const deviceConfig = config.getConfig('device');

  if (typeof deviceConfig === 'object') {
    Object.assign(device, deviceConfig);
  }

  return device;
}

function buildRegs(bidderRequest) {
  if (bidderRequest.gdprConsent) {
    return {
      ext: {
        gdpr: bidderRequest.gdprConsent.gdprApplies ? 1 : 0,
        gdprConsentString: bidderRequest.gdprConsent.consentString,
      },
    };
  }

  return {};
}

function buildUser() {
  const userId = getUserId();

  return {
    id: userId,
  };
}

function extractSchain(bids, requestId) {
  if (!bids || bids.length === 0 || !bids[0].schain) return;

  const schain = bids[0].schain;
  if (schain && schain.nodes && schain.nodes.length && schain.nodes[0]) {
    schain.nodes[0].rid = requestId;
  }

  return schain;
}

function extractEids(bids) {
  if (!bids) return;

  const bid = bids.find(bid => isArray(bid.userIdAsEids) && bid.userIdAsEids.length > 0);
  return bid ? bid.userIdAsEids : bids[0].userIdAsEids;
}

function buildRequest(validBidRequests, bidderRequest) {
  const req = {
    id: bidderRequest.bidderRequestId,
    tmax: bidderRequest.timeout,
    source: {
      fd: 1,
      tid: bidderRequest.auctionId,
    },
    site: {
      domain: location.hostname,
      page: location.href,
      ref: bidderRequest.refererInfo.referer,
    },
    device: buildDevice(),
    regs: buildRegs(bidderRequest),
    user: buildUser(),
    imp: validBidRequests.map((bidRequest) => buildImpression(bidRequest)),
    ext: {
      insticator: {
        adapter: {
          vendor: 'prebid',
          prebid: '$prebid.version$'
        }
      }
    }
  };

  const params = config.getConfig('insticator.params');

  if (params) {
    req.ext = {
      insticator: {...req.ext.insticator, ...params},
    };
  }

  const schain = extractSchain(validBidRequests, bidderRequest.bidderRequestId);

  if (schain) {
    req.source.ext = { schain };
  }

  const eids = extractEids(validBidRequests);

  if (eids) {
    req.user.ext = { eids };
  }

  return req;
}

function buildBid(bid, bidderRequest) {
  const originalBid = find(bidderRequest.bids, (b) => b.bidId === bid.impid);
  let meta = {}

  if (bid.ext && bid.ext.meta) {
    meta = bid.ext.meta
  }

  if (bid.adomain) {
    meta.advertiserDomains = bid.adomain
  }

  return {
    requestId: bid.impid,
    creativeId: bid.crid,
    cpm: bid.price,
    currency: 'USD',
    netRevenue: true,
    ttl: bid.exp || config.getConfig('insticator.bidTTL') || BID_TTL,
    width: bid.w,
    height: bid.h,
    mediaType: 'banner',
    ad: bid.adm,
    adUnitCode: originalBid.adUnitCode,
    ...(Object.keys(meta).length > 0 ? {meta} : {})
  };
}

function buildBidSet(seatbid, bidderRequest) {
  return seatbid.bid.map((bid) => buildBid(bid, bidderRequest));
}

function validateSize(size) {
  return (
    size instanceof Array &&
    size.length === 2 &&
    typeof size[0] === 'number' &&
    typeof size[1] === 'number'
  );
}

function validateSizes(sizes) {
  return (
    sizes instanceof Array &&
    sizes.length > 0 &&
    sizes.map(validateSize).reduce((a, b) => a && b, true)
  );
}

function validateAdUnitId(bid) {
  if (!bid.params.adUnitId) {
    logError('insticator: missing adUnitId bid parameter');
    return false;
  }

  return true;
}

function validateMediaType(bid) {
  if (!(BANNER in bid.mediaTypes || VIDEO in bid.mediaTypes)) {
    logError('insticator: expected banner or video in mediaTypes');
    return false;
  }

  return true;
}

function validateBanner(bid) {
  const banner = deepAccess(bid, 'mediaTypes.banner');

  if (banner === undefined) {
    return true;
  }

  if (
    !validateSizes(bid.sizes) &&
    !validateSizes(bid.mediaTypes.banner.sizes)
  ) {
    logError('insticator: banner sizes not specified or invalid');
    return false;
  }

  return true;
}

function validateVideo(bid) {
  const video = deepAccess(bid, 'mediaTypes.video');

  if (video === undefined) {
    return true;
  }

  const videoSize = [
    deepAccess(bid, 'mediaTypes.video.w'),
    deepAccess(bid, 'mediaTypes.video.h'),
  ];

  if (
    !validateSize(videoSize)
  ) {
    logError('insticator: video size not specified or invalid');
    return false;
  }

  const mimes = deepAccess(bid, 'mediaTypes.video.mimes');

  if (!Array.isArray(mimes) || mimes.length === 0) {
    logError('insticator: mimes not specified');
    return false;
  }

  const placement = deepAccess(bid, 'mediaTypes.video.placement');

  if (typeof placement !== 'undefined' && typeof placement !== 'number') {
    logError('insticator: video placement is not a number');
    return false;
  }

  return true;
}

export const spec = {
  code: BIDDER_CODE,
  gvlid: GVLID,
  supportedMediaTypes: [ BANNER, VIDEO ],

  isBidRequestValid: function (bid) {
    return (
      validateAdUnitId(bid) &&
      validateMediaType(bid) &&
      validateBanner(bid) &&
      validateVideo(bid)
    );
  },
  buildRequests: function (validBidRequests, bidderRequest) {
    const requests = [];
    let endpointUrl = config.getConfig('insticator.endpointUrl') || ENDPOINT;

    if (endpointUrl.indexOf('localhost') === -1) {
      endpointUrl = endpointUrl.replace(/^http:/, 'https:');
    }

    if (validBidRequests.length > 0) {
      requests.push({
        method: 'POST',
        url: endpointUrl,
        options: {
          contentType: 'application/json',
          withCredentials: true,
        },
        data: JSON.stringify(buildRequest(validBidRequests, bidderRequest)),
        bidderRequest,
      });
    }

    return requests;
  },

  interpretResponse: function (serverResponse, request) {
    const bidderRequest = request.bidderRequest;
    const body = serverResponse.body;

    if (!body || body.id !== bidderRequest.bidderRequestId) {
      logError('insticator: response id does not match bidderRequestId');
      return [];
    }

    if (!body.seatbid) {
      return [];
    }

    const bidsets = body.seatbid.map((seatbid) =>
      buildBidSet(seatbid, bidderRequest)
    );

    return bidsets.reduce((a, b) => a.concat(b), []);
  },

  getUserSyncs: function (options, responses) {
    const syncs = [];

    for (const response of responses) {
      if (
        response.body &&
        response.body.ext &&
        response.body.ext.sync instanceof Array
      ) {
        syncs.push(...response.body.ext.sync);
      }
    }

    return syncs;
  },
};

registerBidder(spec);
