import { config } from '../src/config.js';
import { BANNER } from '../src/mediaTypes.js';
import { registerBidder } from '../src/adapters/bidderFactory.js';
import {
  cookiesAreEnabled,
  deepAccess,
  generateUUID,
  getCookie,
  localStorageIsEnabled,
  logError,
  setCookie,
} from '../src/utils.js';

const BIDDER_CODE = 'insticator';
const ENDPOINT = 'https://ex.hunchme.com/v1/openrtb'; // staging endpoint!
const USER_ID_KEY = 'hb_insticator_uid';
const USER_ID_COOKIE_EXP = 2592000000; // 30 days
const BID_TTL = 300; // 5 minutes

config.setDefaults({
  insticator: {
    endpointUrl: ENDPOINT,
    bidTTL: BID_TTL,
  },
});

function getUserId() {
  let uid;

  if (localStorageIsEnabled()) {
    uid = localStorage.getItem(USER_ID_KEY);
  } else {
    uid = getCookie(USER_ID_KEY);
  }

  if (uid && uid.length !== 36) {
    uid = undefined;
  }

  return uid;
}

function setUserId(userId) {
  if (localStorageIsEnabled()) {
    localStorage.setItem(USER_ID_KEY, userId);
  }

  if (cookiesAreEnabled()) {
    const expires = new Date(Date.now() + USER_ID_COOKIE_EXP).toISOString();
    setCookie(USER_ID_KEY, userId, expires);
  }
}

function buildImpression(bidRequest) {
  const format = [];
  const sizes =
    deepAccess(bidRequest, 'mediaTypes.banner.sizes') || bidRequest.sizes;

  for (const size of sizes) {
    format.push({
      w: size[0],
      h: size[1],
    });
  }

  return {
    id: bidRequest.bidId,
    tagid: bidRequest.adUnitCode,
    banner: {
      format,
    },
    ext: {
      insticator: {
        adUnitId: bidRequest.params.adUnitId,
      },
    },
  };
}

function buildDevice() {
  const device = {
    w: window.innerWidth,
    h: window.innerHeight,
    js: true,
    ext: {
      localStorage: localStorageIsEnabled(),
      cookies: cookiesAreEnabled(),
    },
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
  const userId = getUserId() || generateUUID();

  setUserId(userId);

  return {
    id: userId,
  };
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
  };

  const params = config.getConfig('insticator.params');

  if (params) {
    req.ext = {
      insticator: params,
    };
  }

  return req;
}

function buildBid(bid, bidderRequest) {
  const originalBid = bidderRequest.bids.find((b) => b.bidId === bid.impid);

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

function base64Encode(string) {
  string = String(string);

  if (typeof window.btoa !== 'undefined') {
    return window.btoa(string)
  }

  // Polyfill
  var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var bitmap;
  var a;
  var b;
  var c;
  var result = '';
  var i = 0;
  var rest = string.length % 3;

  for (; i < string.length;) {
    if ((a = string.charCodeAt(i++)) > 255 ||
      (b = string.charCodeAt(i++)) > 255 ||
      (c = string.charCodeAt(i++)) > 255) { throw new TypeError("Failed to execute 'btoa' on 'Window': The string to be encoded contains characters outside of the Latin1 range."); }

    bitmap = (a << 16) | (b << 8) | c;
    result += b64.charAt(bitmap >> 18 & 63) + b64.charAt(bitmap >> 12 & 63) +
      b64.charAt(bitmap >> 6 & 63) + b64.charAt(bitmap & 63);
  }

  return rest ? result.slice(0, rest - 3) + '==='.substring(rest) : result;
}

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],

  isBidRequestValid: function (bid) {
    if (!bid.params.adUnitId) {
      logError('insticator: missing adUnitId bid parameter');
      return false;
    }

    if (!(BANNER in bid.mediaTypes)) {
      logError('insticator: expected banner in mediaTypes');
      return false;
    }

    if (
      !validateSizes(bid.sizes) &&
      !validateSizes(bid.mediaTypes.banner.sizes)
    ) {
      logError('insticator: banner sizes not specified or invalid');
      return false;
    }

    return true;
  },

  buildRequests: function (validBidRequests, bidderRequest) {
    const requests = [];

    if (validBidRequests.length > 0) {
      requests.push({
        method: 'POST',
        url: config.getConfig('insticator.endpointUrl') || ENDPOINT,
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

  onBidWon: function(winObj) {
    const cpm = winObj.cpm;

    winObj.ad = winObj.ad.replace(
      /\${AUCTION_PRICE:B64}/,
      base64Encode(cpm)
    );
  },
};

registerBidder(spec);
