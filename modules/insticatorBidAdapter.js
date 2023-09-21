import {config} from '../src/config.js';
import {BANNER} from '../src/mediaTypes.js';
import {registerBidder} from '../src/adapters/bidderFactory.js';
import {deepAccess, generateUUID, logError, isArray} from '../src/utils.js';
import {getStorageManager} from '../src/storageManager.js';
import {find} from '../src/polyfill.js';

const BIDDER_CODE = 'insticator';
const ENDPOINT = 'https://ex.ingage.tech/v1/openrtb'; // production endpoint
const USER_ID_KEY = 'instUid';
const USER_ID_COOKIE_EXP = 7776000000; // 90 days
const BID_TTL = 300; // 5 minutes
const GVLID = 910;

export const storage = getStorageManager({gvlid: GVLID, bidderCode: BIDDER_CODE});

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

function buildImpression(bidRequest) {
  const format = [];
  const ext = {
    insticator: {
      adUnitId: bidRequest.params.adUnitId,
      adUnitName: bidRequest.params.adUnitName,
    },
  }

  /**
   * set impression type using header bidding wrapper's API
   * this is Insticator header bidding wrapper specific
   */
  // eslint-disable-next-line no-undef
  if (bidRequest.adUnitCode && Insticator.getAdUnitStates) {
    try {
      // eslint-disable-next-line no-undef
      const adUnits = Insticator.getAdUnitStates();
      const adUnit = adUnits[bidRequest.adUnitCode]
      // eslint-disable-next-line no-undef
      if (adUnit) ext.insticator.impressionType = adUnit.timesRefreshed > 0 ? adUnit.refreshType : 'il';
    } catch (e) {
      console.warn(e)
    }
  }

  const sizes =
    deepAccess(bidRequest, 'mediaTypes.banner.sizes') || bidRequest.sizes;

  for (const size of sizes) {
    format.push({
      w: size[0],
      h: size[1],
    });
  }

  const gpid = deepAccess(bidRequest, 'ortb2Imp.ext.gpid');

  if (gpid) {
    ext.gpid = gpid;
  }

  const instl = deepAccess(bidRequest, 'ortb2Imp.instl')
  const secure = location.protocol === 'https:' ? 1 : 0;
  const pos = deepAccess(bidRequest, 'mediaTypes.banner.pos');

  return {
    id: bidRequest.bidId,
    tagid: bidRequest.adUnitCode,
    instl,
    secure,
    banner: {
      format,
      pos,
    },
    ext,
  };
}

function buildDevice() {
  const deviceConfig = config.getConfig('device');
  const device = {
    w: window.innerWidth,
    h: window.innerHeight,
    js: true,
    ext: {},
  };

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

function buildUser(bid) {
  const userId = getUserId();
  const yob = deepAccess(bid, 'params.user.yob')
  const gender = deepAccess(bid, 'params.user.gender')

  return {
    id: userId,
    yob,
    gender,
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
    user: buildUser(validBidRequests[0]),
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

function buildBid(bid, bidderRequest, seat) {
  const originalBid = find(bidderRequest.bids, (b) => b.bidId === bid.impid);
  let meta = {}

  if (bid.ext && bid.ext.meta) {
    meta = bid.ext.meta
  }

  if (bid.adomain) {
    meta.advertiserDomains = bid.adomain
  }
  // seatbid.seat = `${bidRequesterId}_${seatbid.seat || ''}`;
  if (seat && typeof seat === 'string') {
    const bidderId = seat.split('_')[0]
    meta.seat = bidderId
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
    adUnitCode: 'div-insticator-ad-16',
    ...(Object.keys(meta).length > 0 ? {meta} : {})
  };
}

function buildBidSet(seatbid, bidderRequest) {
  return seatbid.bid.map((bid) => buildBid(bid, bidderRequest, seatbid.seat));
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

export const spec = {
  code: BIDDER_CODE,
  gvlid: GVLID,
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
    const body = {
      "id": "12c81cf0767e03",
      "seatbid": [
        {
          "bid": [
            {
              "id": "sharethrough_12c81cf0767e03_2",
              "impid": "33b28b97b458fc",
              "price": 0.7209,
              "lurl": "https://b.sharethrough.com/butler?type=lossReasons&arid=cc570299-32cf-4f73-b17f-f64c53260ba4&ckey=458477664&sourceId=0e8893f90b606c9c5d33f1be&umtime=[TIMESTAMP]&action=BannerToNative&pkey=EWW0s30JnpSYaBrHZa9HuQcB&awid=14dec177-3e7a-4109-9f69-ac5d45777976&Lossreason=${AUCTION_LOSS}&deal_id=uU8NF",
              "adm": "<script>(function(){var img = new Image();img.src=\"https://b.sharethrough.com/butler?type=s2s-win&arid=cc570299-32cf-4f73-b17f-f64c53260ba4\"})()</script><div data-str-native-key=\"EWW0s30JnpSYaBrHZa9HuQcB\" data-stx-response-name=\"str_response_cc570299_32cf_4f73_b17f_f64c53260ba4\"></div><script>window[\"str_response_cc570299_32cf_4f73_b17f_f64c53260ba4\"] = \"eyJhZHNlcnZlclJlcXVlc3RJZCI6ImNjNTcwMjk5LTMyY2YtNGY3My1iMTdmLWY2NGM1MzI2MGJhNCIsImh0bWxCZWFjb25zIjpbIjxpZnJhbWUgaWQ9XCJtdWx0aXN5bmMtaWZyYW1lXCIgaGVpZ2h0PVwiMFwiIHdpZHRoPVwiMFwiIG1hcmdpbndpZHRoPVwiMFwiIG1hcmdpbmhlaWdodD1cIjBcIiBzY3JvbGxpbmc9XCJub1wiIGZyYW1lYm9yZGVyPVwiMFwiIHNyYz1cImh0dHBzOi8vc2VjdXJlLWFzc2V0cy5ydWJpY29ucHJvamVjdC5jb20vdXRpbHMveGFwaS9tdWx0aS1zeW5jLmh0bWw_cD0xODY5NCZnZHByPTAmZ2Rwcl9jb25zZW50PVwiIHN0eWxlPVwiYm9yZGVyOiAwcHg7IGRpc3BsYXk6IG5vbmU7XCI-PC9pZnJhbWU-Il0sImNvdW50cnkiOiJDQSIsInBsYWNlbWVudCI6eyJkZWZhdWx0VGVtcGxhdGUiOiI8ZGl2IGNsYXNzPVwic3RyLWFkdW5pdCBzdHItY2FyZC1leHAgc3RyLWFkdW5pdC0zMDB4MjUwIHN0ci17eyNpc2kudGV4dH19aXNpIHN0ci17e2FjdGlvbn19e3svaXNpLnRleHR9fXt7XmlzaS50ZXh0fX17e2FjdGlvbn19e3svaXNpLnRleHR9fSBzdHItYmFubmVyLXt7YmFubmVyX3NpemV9fVwiPlxuICA8ZGl2IGNsYXNzPVwic3RyLXRodW1ibmFpbFwiPjwvZGl2PlxuICA8ZGl2IGNsYXNzPVwic3RyLXRpdGxlIHN0ci10ZXh0XCI-e3t0aXRsZX19PC9kaXY-XG4gIDxkaXYgY2xhc3M9XCJzdHItZGVzY3JpcHRpb25cIiBzdHlsZT1cImRpc3BsYXk6bm9uZVwiPnt7ZGVzY3JpcHRpb259fTwvZGl2PlxuICA8ZGl2IGNsYXNzPVwic3RyLWJvdHRvbVwiPlxuICAgIDxkaXYgY2xhc3M9XCJzdHItYWR2ZXJ0aXNlclwiPnt7cHJvbW90ZWRfYnlfdGV4dH19IHt7YWR2ZXJ0aXNlcn19XG4gICAgICA8ZGl2IGNsYXNzPVwic3RyLWJyYW5kLWxvZ29cIiBzdHlsZT1cImJhY2tncm91bmQtaW1hZ2U6dXJsKHt7YnJhbmRfbG9nb191cmx9fSlcIj48L2Rpdj5cbiAgICA8L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwic3RyLWN0YVwiPlNlZSBNb3JlPC9kaXY-XG4gIDwvZGl2PlxuPHN0eWxlPi5zdHItYWR1bml0LTMwMHgyNTB7Ym94LXNpemluZzpib3JkZXItYm94O3dpZHRoOjMwMHB4O2hlaWdodDoyNTBweDttYXgtd2lkdGg6MzAwcHg7bWF4LWhlaWdodDoyNTBweDtmb250LWZhbWlseTpzYW5zLXNlcmlmO2ZvbnQtc2l6ZToxNHB4O2xpbmUtaGVpZ2h0OjE1cHg7Y29sb3I6IzAwMDtiYWNrZ3JvdW5kLWNvbG9yOiNmZmY7bWFyZ2luOjAgYXV0bztkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1yb3dzOmF1dG8gMWZyO292ZXJmbG93OmhpZGRlbjtib3JkZXI6MXB4IHNvbGlkICNlZWU7dGV4dC1hbGlnbjpsZWZ0fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lcjpub3QoLnN0ci1pc2kpe2ZvbnQtc2l6ZToxMnB4O2dyaWQtdGVtcGxhdGUtcm93czoxODcuNXB4IGF1dG8gYXV0b30uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXItMzAweDUwOm5vdCguc3RyLWlzaSksLnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyLTMyMHg1MDpub3QoLnN0ci1pc2kpe2dyaWQtdGVtcGxhdGUtcm93czo1MHB4IDFmciAxZnIgYXV0b30uc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItYWR2ZXJ0aXNlciwuc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItZGVzY3JpcHRpb24sLnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLXRpdGxle2NvbG9yOiMwMDAhaW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lci0zMDB4NTA6bm90KC5zdHItaXNpKSAuc3RyLWRlc2NyaXB0aW9uLC5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lci0zMjB4NTA6bm90KC5zdHItaXNpKSAuc3RyLWRlc2NyaXB0aW9ue2Rpc3BsYXk6aW5pdGlhbCFpbXBvcnRhbnQ7Zm9udC1zaXplOjE0cHg7dGV4dC1hbGlnbjpjZW50ZXI7cGFkZGluZy10b3A6OXB4fS5zdHItYWR1bml0LTMwMHgyNTAgLnRodW1ibmFpbC13cmFwcGVye3dpZHRoOjEwMCUhaW1wb3J0YW50O2hlaWdodDoxMDAlIWltcG9ydGFudDtiYWNrZ3JvdW5kLWNvbG9yOiNmZmZ9LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLXRodW1ibmFpbHt3aWR0aDoxMDAlO2hlaWdodDphdXRvO2JhY2tncm91bmQtc2l6ZTpjb3ZlcjtiYWNrZ3JvdW5kLXBvc2l0aW9uOjUwJTtiYWNrZ3JvdW5kLXJlcGVhdDpuby1yZXBlYXQ7cGFkZGluZy1ib3R0b206NTYuMjUlfS5zdHItYWR1bml0LTMwMHgyNTAgLnN0ci1hdXRvcGxheSAuc3RyLXRodW1ibmFpbCwuc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItaG9zdGVkLXZpZGVvIC5zdHItdGh1bWJuYWlse3BhZGRpbmctYm90dG9tOjAhaW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAgLnN0ci10aXRsZXtvdmVyZmxvdzpoaWRkZW47cGFkZGluZzo0cHg7Zm9udC13ZWlnaHQ6NzAwfS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lcjpub3QoLnN0ci1pc2kpIC5zdHItdGl0bGV7dGV4dC1hbGlnbjpjZW50ZXJ9LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyLTMwMHg1MDpub3QoLnN0ci1pc2kpIC5zdHItdGl0bGUsLnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyLTMyMHg1MDpub3QoLnN0ci1pc2kpIC5zdHItdGl0bGV7Zm9udC1zaXplOjE4cHg7cGFkZGluZy10b3A6MjdweDtwYWRkaW5nLWJvdHRvbTo5cHh9LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWJvdHRvbXtwYWRkaW5nOjAgNHB4IDRweCA0cHg7ZGlzcGxheTpncmlkO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgYXV0bztmb250LXNpemU6MTJweDtsaW5lLWhlaWdodDoxM3B4fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lcjpub3QoLnN0ci1pc2kpIC5zdHItYm90dG9te3BhZGRpbmc6MCAxMnB4IDEwcHggMTJweH0uc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItYnJhbmQtbG9nb3tkaXNwbGF5OmlubGluZS1ibG9jazt3aWR0aDoxNnB4O2hlaWdodDoxNnB4O21heC13aWR0aDoxNnB4O21heC1oZWlnaHQ6MTZweDtiYWNrZ3JvdW5kLXNpemU6Y29udGFpbjtiYWNrZ3JvdW5kLXBvc2l0aW9uOjUwJTtiYWNrZ3JvdW5kLXJlcGVhdDpuby1yZXBlYXQ7dmVydGljYWwtYWxpZ246bWlkZGxlO2JvcmRlcjpub25lO2JhY2tncm91bmQtY29sb3I6aW5oZXJpdDttYXJnaW4tbGVmdDo0cHh9LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWFkdmVydGlzZXJ7Zm9udC1zaXplOjExcHg7bGluZS1oZWlnaHQ6MTRweDtncmlkLWNvbHVtbjoxLzM7YWxpZ24tc2VsZjpjZW50ZXJ9LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyOm5vdCguc3RyLWlzaSkgLnN0ci1hZHZlcnRpc2Vye2ZvbnQtc2l6ZTo5cHh9LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWN0YXtiYWNrZ3JvdW5kLWNvbG9yOiM1OTY3Nzc7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjVweDtwYWRkaW5nOjRweCAxMHB4O3RleHQtYWxpZ246Y2VudGVyO2dyaWQtY29sdW1uOjQvNX0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXIgLnN0ci1jdGF7YmFja2dyb3VuZC1jb2xvcjojMjUzOTRhO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxNHB4O3dpZHRoOjEyMHB4O2hlaWdodDoyNHB4O2xpbmUtaGVpZ2h0OjI0cHg7cGFkZGluZzppbml0aWFsfS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lci0zMDB4NTA6bm90KC5zdHItaXNpKSAuc3RyLWN0YSwuc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXItMzIweDUwOm5vdCguc3RyLWlzaSkgLnN0ci1jdGF7aGVpZ2h0OjMycHg7bGluZS1oZWlnaHQ6MzJweH0uc3RyLWFkdW5pdC0zMDB4MjUwOmhvdmVyIC5zdHItY3Rhe2JhY2tncm91bmQtY29sb3I6IzRiZDFhNn0uc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItb3B0LW91dC1jb250YWluZXJ7dG9wOjAhaW1wb3J0YW50O2JvdHRvbTp1bnNldCFpbXBvcnRhbnQ7Ym9yZGVyLXJhZGl1czowIDAgMCA4cHghaW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWlzaSAuc3RyLWN0YXtkaXNwbGF5Om5vbmUhaW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWlzaSAuc3RyLW9wdC1vdXQtY29udGFpbmVye2JvdHRvbTp1bnNldCFpbXBvcnRhbnQ7dG9wOjAhaW1wb3J0YW50O3JpZ2h0OjAhaW1wb3J0YW50O2xlZnQ6dW5zZXQhaW1wb3J0YW50O2JvcmRlci1yYWRpdXM6MCAwIDAgOHB4IWltcG9ydGFudH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2l7cGFkZGluZy1ib3R0b206MCFpbXBvcnRhbnQ7Zm9udC1zaXplOjEzLjVweDtncmlkLXRlbXBsYXRlLXJvd3M6MWZyIDFmciAxZnIgMWZyIDFmciAxZnIgMWZyIDFmcn0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2kgLnN0ci1vcHQtb3V0LWxhYmVse21hcmdpbjowIDAgMCA4cHghaW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWlzaSAudGh1bWJuYWlsLXdyYXBwZXJ7b3ZlcmZsb3c6aGlkZGVufS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWlzaSAuc3RyLXRodW1ibmFpbCwuc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2kgLnRodW1ibmFpbC13cmFwcGVye2hlaWdodDoxMDBweCFpbXBvcnRhbnR9LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItaXNpIC5zdHItdGl0bGV7aGVpZ2h0OmF1dG8haW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWlzaSAuc3RyLWlzaS1idW5kbGV7aGVpZ2h0Ojc1cHghaW1wb3J0YW50O3BhZGRpbmc6MCA1cHggMH0uc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItaXNpLWhlYWRsaW5le2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNlZWU7Zm9udC1zaXplOjkwJSFpbXBvcnRhbnR9LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyLTMzNngyODAgLnRodW1ibmFpbC13cmFwcGVye3dpZHRoOjIyNXB4IWltcG9ydGFudDtwbGFjZS1zZWxmOmNlbnRlcn08L3N0eWxlPjwvZGl2PiIsInBsYWNlbWVudEF0dHJpYnV0ZXMiOnsic3RyT3B0T3V0VXJsIjoiaHR0cHM6Ly9wcml2YWN5LWNlbnRlci5zaGFyZXRocm91Z2guY29tL2NvbnN1bWVyLXByaXZhY3ktbm90aWNlIiwicGFzc2JhY2tfdGFnIjpudWxsLCJzaXplIjp7InciOjMwMCwiaCI6MjUwfSwiaGFzQ3VzdG9tVGVtcGxhdGUiOmZhbHNlLCJkb21haW4iOiJjaGVlc2VoZWFkdHYuY29tIiwidGVtcGxhdGVfa2V5IjoiMzAweDI1MC1tcHUiLCJwcm9tb3RlZF9ieV90ZXh0IjoiQWQgQnkiLCJzaXRlX2tleSI6IlhQRzMybHl1YmxyWmhPczR3Y3N6OW9McCIsInRlbXBsYXRlIjoiJmx0O2RpdiBjbGFzcz0mcXVvdDtzdHItYWR1bml0IHN0ci1jYXJkLWV4cCBzdHItYWR1bml0LTMwMHgyNTAgc3RyLXt7I2lzaS50ZXh0fX1pc2kgc3RyLXt7YWN0aW9ufX17ey9pc2kudGV4dH19e3teaXNpLnRleHR9fXt7YWN0aW9ufX17ey9pc2kudGV4dH19IHN0ci1iYW5uZXIte3tiYW5uZXJfc2l6ZX19JnF1b3Q7Jmd0OyAmbHQ7ZGl2IGNsYXNzPSZxdW90O3N0ci10aHVtYm5haWwmcXVvdDsmZ3Q7Jmx0Oy9kaXYmZ3Q7ICZsdDtkaXYgY2xhc3M9JnF1b3Q7c3RyLXRpdGxlIHN0ci10ZXh0JnF1b3Q7Jmd0O3t7dGl0bGV9fSZsdDsvZGl2Jmd0OyAmbHQ7ZGl2IGNsYXNzPSZxdW90O3N0ci1kZXNjcmlwdGlvbiZxdW90OyBzdHlsZT0mcXVvdDtkaXNwbGF5Om5vbmUmcXVvdDsmZ3Q7e3tkZXNjcmlwdGlvbn19Jmx0Oy9kaXYmZ3Q7ICZsdDtkaXYgY2xhc3M9JnF1b3Q7c3RyLWJvdHRvbSZxdW90OyZndDsgJmx0O2RpdiBjbGFzcz0mcXVvdDtzdHItYWR2ZXJ0aXNlciZxdW90OyZndDt7e3Byb21vdGVkX2J5X3RleHR9fSB7e2FkdmVydGlzZXJ9fSAmbHQ7ZGl2IGNsYXNzPSZxdW90O3N0ci1icmFuZC1sb2dvJnF1b3Q7IHN0eWxlPSZxdW90O2JhY2tncm91bmQtaW1hZ2U6dXJsKHt7YnJhbmRfbG9nb191cmx9fSkmcXVvdDsmZ3Q7Jmx0Oy9kaXYmZ3Q7ICZsdDsvZGl2Jmd0OyAmbHQ7ZGl2IGNsYXNzPSZxdW90O3N0ci1jdGEmcXVvdDsmZ3Q7U2VlIE1vcmUmbHQ7L2RpdiZndDsgJmx0Oy9kaXYmZ3Q7ICZsdDtzdHlsZSZndDsuc3RyLWFkdW5pdC0zMDB4MjUwe2JveC1zaXppbmc6Ym9yZGVyLWJveDt3aWR0aDozMDBweDtoZWlnaHQ6MjUwcHg7bWF4LXdpZHRoOjMwMHB4O21heC1oZWlnaHQ6MjUwcHg7Zm9udC1mYW1pbHk6c2Fucy1zZXJpZjtmb250LXNpemU6MTRweDtsaW5lLWhlaWdodDoxNXB4O2NvbG9yOiMwMDA7YmFja2dyb3VuZC1jb2xvcjojZmZmO21hcmdpbjowIGF1dG87ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtcm93czphdXRvIDFmcjtvdmVyZmxvdzpoaWRkZW47Ym9yZGVyOjFweCBzb2xpZCAjZWVlO3RleHQtYWxpZ246bGVmdH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXI6bm90KC5zdHItaXNpKXtmb250LXNpemU6MTJweDtncmlkLXRlbXBsYXRlLXJvd3M6MTg3LjVweCBhdXRvIGF1dG99LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyLTMwMHg1MDpub3QoLnN0ci1pc2kpLC5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lci0zMjB4NTA6bm90KC5zdHItaXNpKXtncmlkLXRlbXBsYXRlLXJvd3M6NTBweCAxZnIgMWZyIGF1dG99LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWFkdmVydGlzZXIsLnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWRlc2NyaXB0aW9uLC5zdHItYWR1bml0LTMwMHgyNTAgLnN0ci10aXRsZXtjb2xvcjojMDAwIWltcG9ydGFudH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXItMzAweDUwOm5vdCguc3RyLWlzaSkgLnN0ci1kZXNjcmlwdGlvbiwuc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXItMzIweDUwOm5vdCguc3RyLWlzaSkgLnN0ci1kZXNjcmlwdGlvbntkaXNwbGF5OmluaXRpYWwhaW1wb3J0YW50O2ZvbnQtc2l6ZToxNHB4O3RleHQtYWxpZ246Y2VudGVyO3BhZGRpbmctdG9wOjlweH0uc3RyLWFkdW5pdC0zMDB4MjUwIC50aHVtYm5haWwtd3JhcHBlcnt3aWR0aDoxMDAlIWltcG9ydGFudDtoZWlnaHQ6MTAwJSFpbXBvcnRhbnQ7YmFja2dyb3VuZC1jb2xvcjojZmZmfS5zdHItYWR1bml0LTMwMHgyNTAgLnN0ci10aHVtYm5haWx7d2lkdGg6MTAwJTtoZWlnaHQ6YXV0bztiYWNrZ3JvdW5kLXNpemU6Y292ZXI7YmFja2dyb3VuZC1wb3NpdGlvbjo1MCU7YmFja2dyb3VuZC1yZXBlYXQ6bm8tcmVwZWF0O3BhZGRpbmctYm90dG9tOjU2LjI1JX0uc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItYXV0b3BsYXkgLnN0ci10aHVtYm5haWwsLnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWhvc3RlZC12aWRlbyAuc3RyLXRodW1ibmFpbHtwYWRkaW5nLWJvdHRvbTowIWltcG9ydGFudH0uc3RyLWFkdW5pdC0zMDB4MjUwIC5zdHItdGl0bGV7b3ZlcmZsb3c6aGlkZGVuO3BhZGRpbmc6NHB4O2ZvbnQtd2VpZ2h0OjcwMH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXI6bm90KC5zdHItaXNpKSAuc3RyLXRpdGxle3RleHQtYWxpZ246Y2VudGVyfS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lci0zMDB4NTA6bm90KC5zdHItaXNpKSAuc3RyLXRpdGxlLC5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lci0zMjB4NTA6bm90KC5zdHItaXNpKSAuc3RyLXRpdGxle2ZvbnQtc2l6ZToxOHB4O3BhZGRpbmctdG9wOjI3cHg7cGFkZGluZy1ib3R0b206OXB4fS5zdHItYWR1bml0LTMwMHgyNTAgLnN0ci1ib3R0b217cGFkZGluZzowIDRweCA0cHggNHB4O2Rpc3BsYXk6Z3JpZDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjtncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyIGF1dG87Zm9udC1zaXplOjEycHg7bGluZS1oZWlnaHQ6MTNweH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXI6bm90KC5zdHItaXNpKSAuc3RyLWJvdHRvbXtwYWRkaW5nOjAgMTJweCAxMHB4IDEycHh9LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWJyYW5kLWxvZ297ZGlzcGxheTppbmxpbmUtYmxvY2s7d2lkdGg6MTZweDtoZWlnaHQ6MTZweDttYXgtd2lkdGg6MTZweDttYXgtaGVpZ2h0OjE2cHg7YmFja2dyb3VuZC1zaXplOmNvbnRhaW47YmFja2dyb3VuZC1wb3NpdGlvbjo1MCU7YmFja2dyb3VuZC1yZXBlYXQ6bm8tcmVwZWF0O3ZlcnRpY2FsLWFsaWduOm1pZGRsZTtib3JkZXI6bm9uZTtiYWNrZ3JvdW5kLWNvbG9yOmluaGVyaXQ7bWFyZ2luLWxlZnQ6NHB4fS5zdHItYWR1bml0LTMwMHgyNTAgLnN0ci1hZHZlcnRpc2Vye2ZvbnQtc2l6ZToxMXB4O2xpbmUtaGVpZ2h0OjE0cHg7Z3JpZC1jb2x1bW46MS8zO2FsaWduLXNlbGY6Y2VudGVyfS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lcjpub3QoLnN0ci1pc2kpIC5zdHItYWR2ZXJ0aXNlcntmb250LXNpemU6OXB4fS5zdHItYWR1bml0LTMwMHgyNTAgLnN0ci1jdGF7YmFja2dyb3VuZC1jb2xvcjojNTk2Nzc3O2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czo1cHg7cGFkZGluZzo0cHggMTBweDt0ZXh0LWFsaWduOmNlbnRlcjtncmlkLWNvbHVtbjo0LzV9LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyIC5zdHItY3Rhe2JhY2tncm91bmQtY29sb3I6IzI1Mzk0YTtjb2xvcjojZmZmO2JvcmRlci1yYWRpdXM6MTRweDt3aWR0aDoxMjBweDtoZWlnaHQ6MjRweDtsaW5lLWhlaWdodDoyNHB4O3BhZGRpbmc6aW5pdGlhbH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1iYW5uZXItMzAweDUwOm5vdCguc3RyLWlzaSkgLnN0ci1jdGEsLnN0ci1hZHVuaXQtMzAweDI1MC5zdHItYmFubmVyLTMyMHg1MDpub3QoLnN0ci1pc2kpIC5zdHItY3Rhe2hlaWdodDozMnB4O2xpbmUtaGVpZ2h0OjMycHh9LnN0ci1hZHVuaXQtMzAweDI1MDpob3ZlciAuc3RyLWN0YXtiYWNrZ3JvdW5kLWNvbG9yOiM0YmQxYTZ9LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLW9wdC1vdXQtY29udGFpbmVye3RvcDowIWltcG9ydGFudDtib3R0b206dW5zZXQhaW1wb3J0YW50O2JvcmRlci1yYWRpdXM6MCAwIDAgOHB4IWltcG9ydGFudH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2kgLnN0ci1jdGF7ZGlzcGxheTpub25lIWltcG9ydGFudH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2kgLnN0ci1vcHQtb3V0LWNvbnRhaW5lcntib3R0b206dW5zZXQhaW1wb3J0YW50O3RvcDowIWltcG9ydGFudDtyaWdodDowIWltcG9ydGFudDtsZWZ0OnVuc2V0IWltcG9ydGFudDtib3JkZXItcmFkaXVzOjAgMCAwIDhweCFpbXBvcnRhbnR9LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItaXNpe3BhZGRpbmctYm90dG9tOjAhaW1wb3J0YW50O2ZvbnQtc2l6ZToxMy41cHg7Z3JpZC10ZW1wbGF0ZS1yb3dzOjFmciAxZnIgMWZyIDFmciAxZnIgMWZyIDFmciAxZnJ9LnN0ci1hZHVuaXQtMzAweDI1MC5zdHItaXNpIC5zdHItb3B0LW91dC1sYWJlbHttYXJnaW46MCAwIDAgOHB4IWltcG9ydGFudH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2kgLnRodW1ibmFpbC13cmFwcGVye292ZXJmbG93OmhpZGRlbn0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2kgLnN0ci10aHVtYm5haWwsLnN0ci1hZHVuaXQtMzAweDI1MC5zdHItaXNpIC50aHVtYm5haWwtd3JhcHBlcntoZWlnaHQ6MTAwcHghaW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWlzaSAuc3RyLXRpdGxle2hlaWdodDphdXRvIWltcG9ydGFudH0uc3RyLWFkdW5pdC0zMDB4MjUwLnN0ci1pc2kgLnN0ci1pc2ktYnVuZGxle2hlaWdodDo3NXB4IWltcG9ydGFudDtwYWRkaW5nOjAgNXB4IDB9LnN0ci1hZHVuaXQtMzAweDI1MCAuc3RyLWlzaS1oZWFkbGluZXtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjZWVlO2ZvbnQtc2l6ZTo5MCUhaW1wb3J0YW50fS5zdHItYWR1bml0LTMwMHgyNTAuc3RyLWJhbm5lci0zMzZ4MjgwIC50aHVtYm5haWwtd3JhcHBlcnt3aWR0aDoyMjVweCFpbXBvcnRhbnQ7cGxhY2Utc2VsZjpjZW50ZXJ9Jmx0Oy9zdHlsZSZndDsmbHQ7L2RpdiZndDsiLCJjc3NPdmVycmlkZXMiOiIiLCJtYXhfaGVhZGxpbmVfbGVuZ3RoIjoxNDAsInB1Ymxpc2hlcl9rZXkiOiJROUl6SGR2cCJ9LCJhbGxvd0luc3RhbnRQbGF5Ijp0cnVlLCJzdGF0dXMiOiJsaXZlIiwibGF5b3V0Ijoic2luZ2xlIn0sImNyZWF0aXZlcyI6W3siY3JlYXRpdmUiOnsianNUcmFja2VyIjpbIjwhRE9DVFlQRSBodG1sPlxuPGh0bWw-XG4gICAgPGhlYWQ-XG4gICAgICAgIDxzY3JpcHQgc3JjPVwiaHR0cHM6Ly9wZ2h1Yi5pby9qcy9wYW5kZy1zZGsuanNcIiAgdHlwZT1cInRleHQvamF2YXNjcmlwdFwiID48XFwvc2NyaXB0PlxuICAgICAgICA8c2NyaXB0IHR5cGU9XCJ0ZXh0L2phdmFzY3JpcHRcIiA-XG4gICAgICAgICAgICB2YXIgbWV0YWRhdGEgPSB7XG4gICAgICAgICAgICAgICAgZ2RwcjogbnVsbCxcbiAgICAgICAgICAgICAgICBnZHByX2NvbnNlbnQ6IG51bGwsXG4gICAgICAgICAgICAgICAgY2NwYTogbnVsbCxcbiAgICAgICAgICAgICAgICBicF9pZDogXCJzaGFyZXRocm91Z2hcIlxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHZhciBjb25maWcgPSB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJQJkdcIixcbiAgICAgICAgICAgICAgICBwaXhlbFVybDogXCJodHRwczovL3BhbmRnLnRhcGFkLmNvbS90YWdcIlxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgdmFyIHRhZ2dlciA9IFRhcGFkLmluaXQobWV0YWRhdGEsIGNvbmZpZyk7XG4gICAgICAgICAgICAgICAgdmFyIGRhdGEgPSB7fTtcbiAgICAgICAgICAgICAgICB0YWdnZXIuc3luYyhkYXRhKS50aGVuKGNvbnNvbGUubG9nKTtcbiAgICAgICAgICAgIH0sIDUwMDApO1xuICAgICAgICA8XFwvc2NyaXB0PlxuICAgIDwvaGVhZD5cbiAgICA8Ym9keT5cbiAgICA8L2JvZHk-XG48L2h0bWw-Il0sInNpemUiOnsidyI6MzAwLCJoIjoyNTB9LCJmb3JjZV9jbGlja190b19wbGF5IjpmYWxzZSwidmFyaWFudF9rZXkiOiIiLCJhZG0iOiI8c2NyaXB0IHNyYz1cImh0dHBzOi8vbnltMS1pYi5hZG54cy5jb20vYWI_YW5fYXVkaXQ9MCZyZWZlcnJlcj1odHRwcyUzQSUyRiUyRmNoZWVzZWhlYWR0di5jb20lMkYmZT13cVRfM1FLb0RfQlZxQWNBQUFNQTFnQUZBUWoxMllLb0JoRFlfZV9MMWNhQWxoOFk5cXZmei02UTFOVTZLallKTkVpRE5FaUQ5RDhSQUFBQUFBQUE4RDhaQUFBQVlJX0NFMEFocXcwRXQ2U1o4VDhwalhxSVJuZVE5ajh4QUFBQkpiandQekM0NUxBT09PRWFRSmc1U0FKUTRLRFAyZ0ZZa2UtbUFXQUFhT2pveWdGNDd2MEZnQUVCaWdFRFZWTkVrZ1VHOEV5WUFhd0NvQUg2QWFnQkFiQUJBTGdCQXNBQkJjZ0JBdEFCQ2RnQkFPQUJBUEFCQUlvQ2FIVm1LQ2RoSnl3Z01qZ3hNelE0TlN3Z01DazdkV1lvSjJrbkxDQTROREkyTWpRMkxDQXdLUVVVQUdjQktCZ3lNalF3TnpZMEZTa3NZeWNzSURVM01qazNOakl3RlJVb2NpY3NJRFExT0RRM056WU5LX1JJQVpJQzVRUWhSek10V21kbmFsVnNZV3RpUlU5RFozbzViMEpIUVVGbmEyVXRiVUZVUVVKUFFVSkJRVVZwV1U5V1F6UTFURUZQVjBGQ1ozWm5WbTlCU0VGQlpVRkRRVUZSUzBsQldYRnVRWEJCUWtGYVowSkJZVUZDUVhGblFrRnlRVUpCVEd0Q2NtUkNTbnB1VDFFNWFsOUNRV0V6VVZOak5YcHJVRmxmZVZGRlFVRkJRbWR4WTE5cVVEbHJRa0ZCUVVGQlFVRkJPRVJmWjBGWllXMW5aMVF4UVdONk5rMXJRMWxCWjBOblFXZExNVUZuUVVGQlFVTTVRV2RCUVVGQlJFRkJaMHhKUVc5eGJrRjBRVU5CZEdkRGFYRmpRelJCU1VFMlFVbEJMVUZKUVdkQlRVSnRRVTFDYjJkTlZVTlBUMk5zYVRSUlEyaG5Ra3hWZERsSWFqaDVRa2RPTUUxcVV6WkJkMnhQVjFVd2VVOXFXWGxPVkZCblFUY3hSV2RCVTNBNVRsRk1hVUZVTmprNVVVeHJRVkZDYlVGUlJYZFJVVUZCUVVGQlFVRkJRVUZOYTBWQlFVRkJBYmdjUVVGRVdVSkJSSGdWeVVSQlFVRnBRVmgwVFVwQlJtNUpNWEp4VVZVQkV3RW9FSGRRTjBWR0FRb0pBUXhFUWtKUkNRb0JBUUI1TGlnQUFEa3lLQUFBV2hVb1NGQkJYelJCV0dwNlVXcHhRbE5aU1VGNFNXa0JXZkJsYWtSclNqQndkM1UzTVhGaE1XeEpUSE5aY2xORGJuVkpUMHBpZFdsd2RYVlVSME5aTnpaQk1tTmZRVVpmVEhaT1EzWm5SbkprZVhKQldVbEhRVEZXVkZKSlowZENTa0ZIUVZwblIwRkxSVWN5WDJ3dFlYSjRNRGQ2TFc5Q1oxTjVRbWxSU2tGQkFhWUZBUUJTQlFZSkFRQmFDUWNGQVFCb0JRWUZBVUJETkVKbmJ5NmFBcGtCSVdoQ1dVaHZaenBwQW5CS1NIWndaMFZuUVVOblFVMWtkalZtYlhFNFpFODRYMDluYkU5WFZUR1JGRTVCZGxWU1NnVlFGRUZCUVRoRU9SMTVBRUlkZVFCQ0hYa0VRbkFCTEFrQkJFSjRDUWdCQVJCQ05FRkpheldrMkRoRU9DN1lBdnRENEFLMTNTanFBaGxvZEhSd2N6b3ZMMk5vWldWelpXaGxZV1IwZGk1amIyMHY4Z0lSQ2daQlJGWmZTVVFTQnpKcG1CenlBaElLQmtOUVJ3RVVCQWd5YllRWThnSUtDZ1ZEVUFFVVJBRXc4Z0lOQ2doQlJGWmZSbEpGVVJJQk1RVVFIRkpGVFY5VlUwVlNCU0FBREFrZ0dFTlBSRVVTQVBJQkR3RlJFUThRQ3dvSFExQVZEaEFRQ2dWSlR3RlpDQWM0TklVRkFQSUJJUVJKVHhVaE9CTUtEME5WVTFSUFRWOU5UMFJGVEFFckZBRHlBaG9LRmpJV0FCeE1SVUZHWDA1QlRRVnhDQjRLR2pZZEFBaEJVMVFCUGhCSlJrbEZSQUUtSEEwS0NGTlFURWxVQVUzdzNnRXdnQU1BaUFNQmtBT2NqV3VZQXhTZ0F3R3FBd0RBQTlnRXlBTUEyQVBibnpEZ0F3RG9Bd0Q0QXdPQUJBQ1NCQWt2YjNCbGJuSjBZaktZQkFDaUJBMHhOREl1TVRFMExqZ3VNalE1cUFURnlSNnlCQXdJQUJBQUdBQWdBREFBT0FDNEJBREFCQURJQkFEU0JBNDNNekl3STA1WlRUSTZOakkxTTlvRUFnZ0I0QVFBOEFUZ29NX2FBZm9FRWdrQUFBQmc4TTFGUUJFQUFBQkFBLUJUd0lnRkFaZ0ZBS0FGX19fX19fX19fX19fQWFvRkpHTmpOVGN3TWprNUxUTXlZMll0TkdZM015MWlNVGRtTFdZMk5HTTFNekkyTUdKaE5NQUZBTWtGQUFDcDFRelNCUWtKQVFvQkFYRFlCUUhnQlFId0Jhdk5VUG9GQkFnQUVBQ1FCZ0NZQmdDNEJnREJCZ0VoTUFBQThEX1FCcWtsMmdZV0NoQUpFUmtCY0JBQUdBRGdCZ0h5QmdJSUFJQUhBWWdIQUtBSEFjZ0g3djBGMGdjTkZXUUJKZ2phQndZQlhmRDdHQURnQndEcUJ3SUlBUEFIb2ZnZmlnalRBUXJPQVFBQUFZcUtvNTBJSHl3Q05WbDdfdGdFMzZSVGtPMG5reXJicXZ5aEVSVzZ1d1paLW5VUG9qVDFHVldqbjRETFA3X1BSX2lwbVhibVd5MnltQjNIZm5FZWVPTkNqSnphNXVfdER0VDdSSlpwLTFGZkRLS2dfTkNXMndIRGtNUzgxSDNxN3pGdEJ2ZzRQQnBKencwWGVVZEk2X1g4VWE5MVlGZ3g3TGR3Q094RklwRmpBZ3lhMXRENEVzSmJtX3d6OEdsZGV4Y194a1JFSzZ2RVo3ZVRqYmRDNVdSMWo0VU1VVEdMOUpPWTh3VnBxX3U0dWVVUENuM0Q2Z3k0cEtDd0M4bkpNdTYydXdIZG9yMWdKSy1XRUFHVkNBQUFnRC1ZQ0FIQUNQdEQwZ2dHQ0FBUUFCZ0Emcz1mZmNjODQwOGQ5MzgwYmFhM2MxY2M4MWE4OTBiNTBmNjM4MThjZmNhJnBwPTFcIj48XFwvc2NyaXB0PiIsImFkdmVydGlzZXIiOiIiLCJiZWFjb25zIjp7InZpc2libGUiOltdLCJwbGF5IjpbXSwiY29tcGxldGVkX3NpbGVudF9wbGF5IjpbXSwidGhpcnR5X3NlY29uZF9zaWxlbnRfcGxheSI6W10sInNpbGVudF9wbGF5IjpbXSwiZmlmdGVlbl9zZWNvbmRfc2lsZW50X3BsYXkiOltdLCJjbGljayI6W10sImZpcnN0X3F1YXJ0aWxlIjpbXSwibWlkcG9pbnQiOltdLCJ0ZW5fc2Vjb25kX3NpbGVudF9wbGF5IjpbXSwidGhpcmRfcXVhcnRpbGUiOltdLCJpbXByZXNzaW9uIjpbXX0sInNvdXJjZV9pZCI6IjBlODg5M2Y5MGI2MDZjOWM1ZDMzZjFiZSIsInNlYXRfaWQiOiI3MzIwIiwidGl0bGUiOiIiLCJhY3Rpb24iOiJiYW5uZXIiLCJjcmVhdGl2ZV9rZXkiOiIwZTg4OTNmOTBiNjA2YzljNWQzM2YxYmUtNDU4NDc3NjY0IiwiY2FtcGFpZ25fa2V5IjoiNzMyMCIsImRlc2NyaXB0aW9uIjoiIiwibWVkaWFfdXJsIjoiIiwiY3VzdG9tX2VuZ2FnZW1lbnRfdXJsIjoiIiwidGh1bWJuYWlsX3VybCI6IiIsImJyYW5kX2xvZ29fdXJsIjoiIiwiZGVhbF9pZCI6InVVOE5GIiwiY3VzdG9tX2VuZ2FnZW1lbnRfbGFiZWwiOiIifSwiYXVjdGlvbldpbklkIjoiMTRkZWMxNzctM2U3YS00MTA5LTlmNjktYWM1ZDQ1Nzc3OTc2IiwidmVyc2lvbiI6MX1dLCJzdHhVc2VySWQiOiJiNWU2ZWUyYS05NGI2LTRlNTItYTE2ZS0yNTcxOTNmN2NkOTIiLCJzdXBwbHlJZCI6ImpjM1RrbXI2IiwiY29va2llU3luY1VybHMiOlsiaHR0cHM6Ly9wci1iaC55YnAueWFob28uY29tL3N5bmMvc2hhcmV0aHJvdWdoL2I1ZTZlZTJhLTk0YjYtNGU1Mi1hMTZlLTI1NzE5M2Y3Y2Q5Mj9nZHByPTAmZ2Rwcl9jb25zZW50PSIsImh0dHBzOi8vcGl4ZWwucnViaWNvbnByb2plY3QuY29tL2V4Y2hhbmdlL3N5bmMucGhwP3A9MTg2OTQmZ2Rwcj0wJmdkcHJfY29uc2VudD0iLCJodHRwczovL3NpZC5zdG9yeWdpemUubmV0L2NjbS9jOWRkNzFiNi1mZDEzLTQxMzMtYmY1ZC1iODg2MTljZWY0OTEiLCIiLCJodHRwczovL2NyZWF0aXZlY2RuLmNvbS9jbS1ub3RpZnk_cGk9c2hhcmV0aHJvdWdoJmdkcHI9MCZnZHByX2NvbnNlbnQ9IiwiaHR0cHM6Ly94LmJpZHN3aXRjaC5uZXQvc3luYz9zc3A9c2hhcmV0aHJvdWdoJnVzZXJfaWQ9YjVlNmVlMmEtOTRiNi00ZTUyLWExNmUtMjU3MTkzZjdjZDkyJmdkcHI9MCZnZHByX2NvbnNlbnQ9JmdkcHJfcGQ9MSZ1c3ByaXZhY3k9IiwiaHR0cHM6Ly9zZWN1cmUuYWRueHMuY29tL2dldHVpZD9odHRwczovL21hdGNoLnNoYXJldGhyb3VnaC5jb20vc3luYy92MT9zb3VyY2VfaWQ9MGU4ODkzZjkwYjYwNmM5YzVkMzNmMWJlJmdkcHI9MCZnZHByX2NvbnNlbnQ9JnNvdXJjZV91c2VyX2lkPSRVSUQiLCJodHRwczovL2Ixc3luYy56ZW1hbnRhLmNvbS91c2Vyc3luYy9zaGFyZXRocm91Z2g_Z2Rwcj0wJmdkcHJfY29uc2VudD0iLCJodHRwczovL3BpeGVsLnJ1Ymljb25wcm9qZWN0LmNvbS9leGNoYW5nZS9zeW5jLnBocD9wPTE4Njk0JmdkcHI9MCZnZHByX2NvbnNlbnQ9IiwiaHR0cHM6Ly9jbXMucXVhbnRzZXJ2ZS5jb20vcGl4ZWwvcC1falEwMzdwU210amhOLmdpZj9pZG1hdGNoPTEmZ2Rwcj0wJmdkcHJfY29uc2VudD0iLCJodHRwczovL2VuZ2FnZWZyb250LnRoZXdlYXRoZXJuZXR3b3JrLmNvbS9weGwiLCJodHRwczovL3BtLnc1NWMubmV0L3BpbmdfbWF0Y2guZ2lmP3N0PVNoYXJlVGhyb3VnaCZydXJsPWh0dHBzJTNBJTJGJTJGbWF0Y2guc2hhcmV0aHJvdWdoLmNvbSUyRnN5bmMlMkZ2MSUzRnNvdXJjZV9pZCUzRFluVUJzNVl6OVpxank5VkNjb0N4cXVGUCUyNnNvdXJjZV91c2VyX2lkJTNEX3dmaXZlZml2ZWNfIiwiaHR0cHM6Ly9jMS5hZGZvcm0ubmV0L3NlcnZpbmcvY29va2llL21hdGNoP3BhcnR5PTEyOTQmZ2Rwcj0wJmdkcHJfY29uc2VudD0iLCJodHRwczovL3N5bmMuc3J2LnN0YWNrYWRhcHQuY29tL3N5bmM_bmlkPTE5OSIsImh0dHBzOi8vc3luYy5zcnYuc3RhY2thZGFwdC5jb20vc3luYz9uaWQ9MTUiLCJodHRwczovL2ltYWdlOC5wdWJtYXRpYy5jb20vQWRTZXJ2ZXIvSW1nU3luYz9wPTE1NjU1NyZnZHByPTAmZ2Rwcl9jb25zZW50PSZwdT1odHRwcyUzQSUyRiUyRmltYWdlNC5wdWJtYXRpYy5jb20lMkZBZFNlcnZlciUyRlNQdWclM0ZwJTNEMTU2NTU3JTI2cHIlM0RodHRwcyUyNTNBJTI1MkYlMjUyRm1hdGNoLnNoYXJldGhyb3VnaC5jb20lMjUyRnN5bmMlMjUyRnYxJTI1M0Zzb3VyY2VfaWQlMjUzRHVGRnI1UkZCWWdvVUpiV01BV0dFWktTMyUyNTI2c291cmNlX3VzZXJfaWQlMjUzRCUyNTIzUE1VSUQiLCJodHRwczovL21hdGNoLmFkc3J2ci5vcmcvdHJhY2svY21mL2dlbmVyaWM_dHRkX3BpZD1zaGFyZXRocm91Z2gmdHRkX3RwaT0xJmdkcHI9MCZnZHByX2NvbnNlbnQ9IiwiaHR0cHM6Ly91Lm9wZW54Lm5ldC93LzEuMC9jbT9nZHByPTAmZ2Rwcl9jb25zZW50PSZpZD03ZWFkNDM1ZS1hMmNkLTRjYmYtODg3Ni1hZGI2NjgyMjYxM2YmcGg9YzZiMDFlMTItYWE2Mi00YWU2LTllMTAtNzEzNDZlNTk3YzMxJnI9aHR0cHMlM0ElMkYlMkZtYXRjaC5zaGFyZXRocm91Z2guY29tJTJGc3luYyUyRnYxJTNGc291cmNlX2lkJTNERjJTdG90aG0zd2c1ZzZvcFR1YVBhZHo5JTI2c291cmNlX3VzZXJfaWQlM0QiLCJodHRwczovL3NlY3VyZS5hZG54cy5jb20vZ2V0dWlkP2h0dHBzOi8vbWF0Y2guc2hhcmV0aHJvdWdoLmNvbS9zeW5jL3YxP3NvdXJjZV9pZD0wZTg4OTNmOTBiNjA2YzljNWQzM2YxYmUmZ2Rwcj0wJmdkcHJfY29uc2VudD0mc291cmNlX3VzZXJfaWQ9JFVJRCIsImh0dHBzOi8vbWF0Y2gucHJvZC5iaWRyLmlvL2Nvb2tpZS1zeW5jL3Nocj9nZHByPTAmZ2Rwcl9jb25zZW50PSIsImh0dHBzOi8vYmguY29udGV4dHdlYi5jb20vYmgvcnRzZXQ_cGlkPTU1ODM1NyZldj0xJnJ1cmw9aHR0cHMlM2ElMmYlMmZtYXRjaC5zaGFyZXRocm91Z2guY29tL3N5bmMvdjE_c291cmNlX2lkPTc5MGQzZTAxNzRiMTJhODZmMWNiZWJmNCZzb3VyY2VfdXNlcl9pZD0lJVZHVUlEJSUiLCJodHRwczovL2Rpcy5jcml0ZW8uY29tL2Rpcy91c2Vyc3luYy5hc3B4P3I9NDEmcD0yNDQmY3A9c2hhcmV0aHJvdWdoJmN1PTEmZ2Rwcj0wJmdkcHJfY29uc2VudD0mdXJsPWh0dHBzJTNBJTJGJTJGbWF0Y2guc2hhcmV0aHJvdWdoLmNvbSUyRnN5bmMlMkZ2MSUzRnNvdXJjZV9pZCUzRDc2NThjYjFkNzdhNjYwODgyYjQ4ZGIwNiUyNnNvdXJjZV91c2VyX2lkJTNEJTQwJTQwQ1JJVEVPX1VTRVJJRCU0MCU0MCIsImh0dHBzOi8vc3luYy5zcnYuc3RhY2thZGFwdC5jb20vc3luYz9uaWQ9MTIzIiwiaHR0cHM6Ly94LmJpZHN3aXRjaC5uZXQvc3luYz9zc3A9c2hhcmV0aHJvdWdoJnVzZXJfaWQ9YjVlNmVlMmEtOTRiNi00ZTUyLWExNmUtMjU3MTkzZjdjZDkyJmdkcHI9MCZnZHByX2NvbnNlbnQ9JmdkcHJfcGQ9MSZ1c3ByaXZhY3k9IiwiaHR0cHM6Ly9jcy5hZG1hbm1lZGlhLmNvbS9jMDFkMDI0NmQ3OWViYTY0YjhhN2NjYTA3ZTViN2RjNy5naWY_cHVpZD1iNWU2ZWUyYS05NGI2LTRlNTItYTE2ZS0yNTcxOTNmN2NkOTImcmVkaXI9aHR0cHMlM0ElMkYlMkZtYXRjaC5zaGFyZXRocm91Z2guY29tJTJGc3luYyUyRnYxJTNGc291cmNlX2lkJTNEJTIwcVVWSlRIdXRETGN5R1JTOHhmc1cyTTRnJTI2c291cmNlX3VzZXJfaWQlM0QiLCIgIiwiIiwiaHR0cHM6Ly9zeW5jLjFyeC5pby91c2Vyc3luYzIvc2hhcmV0aHJvdWdoIiwiaHR0cHM6Ly9zc2MtY21zLjMzYWNyb3NzLmNvbS9wcy8_cmk9MDAxMzMwMDAwMWtRajJIQUFTJnJ1PWh0dHBzJTNBJTJGJTJGbWF0Y2guc2hhcmV0aHJvdWdoLmNvbSUyRnN5bmMlMkZ2MSUzRnNvdXJjZV9pZCUzRGt6Rnl6enFYRXF1a01EdW1wVkxCNkVxMyUyNnNvdXJjZV91c2VyX2lkJTNEMzNYVVNFUklEMzNYIiwiaHR0cHM6Ly94LmJpZHN3aXRjaC5uZXQvc3luYz9zc3A9c2hhcmV0aHJvdWdoJnVzZXJfaWQ9YjVlNmVlMmEtOTRiNi00ZTUyLWExNmUtMjU3MTkzZjdjZDkyJmdkcHI9MCZnZHByX2NvbnNlbnQ9JmdkcHJfcGQ9MSZ1c3ByaXZhY3k9IiwiIiwiIiwiaHR0cHM6Ly9zLmFkLnNtYWF0by5uZXQvYy8_YWRFeEluaXQ9cyZyZWRpcj1odHRwcyUzQSUyRiUyRm1hdGNoLnNoYXJldGhyb3VnaC5jb20lMkZzeW5jJTJGdjElM0Zzb3VyY2VfaWQlM0R4VEZKYkxiczM3dHloYktzUFA5VkMyY20lMjZzb3VyY2VfdXNlcl9pZCUzRCUyNFVJRCIsImh0dHBzOi8vc3NwLmRpc3F1cy5jb20vcmVkaXJlY3R1c2VyP3I9aHR0cHMlM0ElMkYlMkZtYXRjaC5zaGFyZXRocm91Z2guY29tJTJGc3luYyUyRnYxJTNGc291cmNlX2lkJTNEN3JrSkFoUENXWGJ3OUxxNWRaeGM2VHZOJTI2c291cmNlX3VzZXJfaWQlM0QlMjRVSUQmcGFydG5lcj1zaGFyZXRocm91Z2giLCJodHRwczovL2VuZ2FnZWZyb250LnRoZXdlYXRoZXJuZXR3b3JrLmNvbS9weGwiLCJodHRwczovL2NtLmcuZG91YmxlY2xpY2submV0L3BpeGVsP2dvb2dsZV9uaWQ9c2hhcmV0aHJvdWdoX2RibSZnZHByPTAmZ2Rwcl9jb25zZW50PSZnb29nbGVfaG09WWpWbE5tVmxNbUV0T1RSaU5pMDBaVFV5TFdFeE5tVXRNalUzTVRrelpqZGpaRGt5IiwiaHR0cHM6Ly9zeW5jLXRtLmV2ZXJlc3R0ZWNoLm5ldC91cGkvcGlkL2J5TjU5TmNCP3JlZGlyPWh0dHBzJTNBJTJGJTJGbWF0Y2guc2hhcmV0aHJvdWdoLmNvbSUyRnN5bmMlMkZ2MSUzRnNvdXJjZV9pZCUzRFN2V3VRSFViTVduaHNDRFlqZWFxODFVMiUyNnNvdXJjZV91c2VyX2lkJTNEJTI0JTdCVE1fVVNFUl9JRCU3RCUwQSIsImh0dHBzOi8vYnR0cmFjay5jb20vcGl4ZWwvY29va2llc3luYz9zb3VyY2U9ZDBhZmRmZjUtYzUxZS00YThkLWIwN2ItYjUyYTI5MDE1MTcwJnNlY3VyZT0xIiwiaHR0cHM6Ly9lbmdhZ2Vmcm9udC50aGV3ZWF0aGVybmV0d29yay5jb20vcHhsP3N0aWQmaWQ9YjVlNmVlMmEtOTRiNi00ZTUyLWExNmUtMjU3MTkzZjdjZDkyXG4iLCJodHRwczovL3guYmlkc3dpdGNoLm5ldC9zeW5jP3NzcD1zaGFyZXRocm91Z2gmdXNlcl9pZD1iNWU2ZWUyYS05NGI2LTRlNTItYTE2ZS0yNTcxOTNmN2NkOTImZ2Rwcj0wJmdkcHJfY29uc2VudD0mZ2Rwcl9wZD0xJnVzcHJpdmFjeT0iLCJodHRwczovL3NzYnN5bmMuc21hcnRhZHNlcnZlci5jb20vYXBpL3N5bmM_Y2FsbGVySWQ9NDcmZ2Rwcj0wJmdkcHJfY29uc2VudD0iLCJodHRwczovL3N0eC1tYXRjaC5kb3RvbWkuY29tL21hdGNoL2JvdW5jZS9jdXJyZW50P25ldHdvcmtJZD00NDQxMCZ2ZXJzaW9uPTEmbnVpZD1iNWU2ZWUyYS05NGI2LTRlNTItYTE2ZS0yNTcxOTNmN2NkOTImZ2Rwcj0wJmdkcHJfY29uc2VudD0iLCJodHRwczovL3NzYy1jbXMuMzNhY3Jvc3MuY29tL3BzLz9yaT0wMDEzMzAwMDAxa1FqMkhBQVMmcnU9aHR0cHMlM0ElMkYlMkZtYXRjaC5zaGFyZXRocm91Z2guY29tJTJGc3luYyUyRnYxJTNGc291cmNlX2lkJTNEa3pGeXp6cVhFcXVrTUR1bXBWTEI2RXEzJTI2c291cmNlX3VzZXJfaWQlM0QzM1hVU0VSSUQzM1giLCJodHRwczovL3MuYW1hem9uLWFkc3lzdGVtLmNvbS9lY20zP2V4PXNoYXJldGhyb3VnaC5jb20maWQ9YjVlNmVlMmEtOTRiNi00ZTUyLWExNmUtMjU3MTkzZjdjZDkyIiwiaHR0cHM6Ly91cHMuYW5hbHl0aWNzLnlhaG9vLmNvbS91cHMvNTgyODAvc3luYz91aWQ9YjVlNmVlMmEtOTRiNi00ZTUyLWExNmUtMjU3MTkzZjdjZDkyJl9vcmlnaW49MSIsImh0dHBzOi8vYy5iaW5nLmNvbS9jLmdpZj9SZWQzPVNUTVNfcGQmdWlkPWI1ZTZlZTJhLTk0YjYtNGU1Mi1hMTZlLTI1NzE5M2Y3Y2Q5MiIsImh0dHBzOi8vaWRzeW5jLnJsY2RuLmNvbS83MTIwNjguZ2lmP3BhcnRuZXJfdWlkPWI1ZTZlZTJhLTk0YjYtNGU1Mi1hMTZlLTI1NzE5M2Y3Y2Q5MiIsImh0dHBzOi8vY20uZy5kb3VibGVjbGljay5uZXQvcGl4ZWw_Z29vZ2xlX25pZD1zaGFyZXRocm91Z2hfb2ImZ2Rwcj0wJmdkcHJfY29uc2VudD0mZ29vZ2xlX2htPVlqVmxObVZsTW1FdE9UUmlOaTAwWlRVeUxXRXhObVV0TWpVM01Ua3paamRqWkRreSIsImh0dHBzOi8vZXguaW5nYWdlLnRlY2gvdjEvc3luY1BhZ2Uvc2hhcmV0aHJvdWdoP3VpZD1iNWU2ZWUyYS05NGI2LTRlNTItYTE2ZS0yNTcxOTNmN2NkOTIiXX0=\"</script><script>(function() {if (!(window.STR && window.STR.Tag)) {const sfp_js = document.createElement('script');sfp_js.src = \"https://native.sharethrough.com/assets/sfp.js\";sfp_js.type = 'text/javascript';sfp_js.charset = 'utf-8';try {window.document.getElementsByTagName('body')[0].appendChild(sfp_js);} catch(e) {console.log(e);}}})();</script><div style=\"position:absolute;left:0;top:0;visibility:hidden;\"><img src=\"https://ex.ingage.tech/v1/win?v=Ny40Mi4w&did=c2hhcmV0aHJvdWdo&bid=MDFIQTVBNzdYTTYxSENKTlEyRENRR0ZDSEs%3D&price=0.7209\" /></div>",
              "adomain": [
                "pointsbet.ca"
              ],
              "cid": "7320",
              "crid": "458477664",
              "cat": [
                "IAB1-8"
              ],
              "dealid": "uU8NF",
              "w": 300,
              "h": 250,
              "exp": 600,
              "ext": {
                "networkId": "0e8893f90b606c9c5d33f1be",
                "networkName": "Xandr"
              }
            }
          ],
          "seat": "sharethrough_7320"
        }
      ],
      "bidid": "01HA5A77XH23NVPTC9RT8FVB71",
      "ext": {}
    };


    //
    // if (!body || body.id !== bidderRequest.bidderRequestId) {
    //   logError('insticator: response id does not match bidderRequestId');
    //   return [];
    // }

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
