import {ajax} from 'src/ajax';
import adapter from 'src/AnalyticsAdapter';
import adaptermanager from 'src/adaptermanager';
import CONSTANTS from 'src/constants.json';
const utils = require('src/utils');
import includes from 'core-js/library/fn/array/includes';
const events = require('src/events');

/****
 * insticator Analytics
 *
 * For testing:
 *
 instBid.enableAnalytics({
  provider: 'insticator',
  options: {
    site: 'sitename.com',
    endpoint: 'https://event.hunchme.com/v1/event',
  }
 });
 */

const analyticsType = 'endpoint';
const analyticsName = 'Insticator Analytics: ';
const globalName = 'insticator';
let defaultUrl = 'https://event.hunchme.com/v1/event';
let configOptions = {site: '970cf10f-ee00-48e8-8280-9c4b63f7feb8', endpoint: 'https://event.hunchme.com/v1/event', debug: 'true'};

const {
  EVENTS: {
    AUCTION_INIT,
    AUCTION_END,
    BID_REQUESTED,
    BID_RESPONSE,
    BID_TIMEOUT,
    BID_ADJUSTMENT,
    BIDDER_DONE,
    BID_WON
  }
} = CONSTANTS;

var _sampled = true;

function sendEvent(eventType, data) {

}

function sendDataEvent(eventType, data) {
  // put the typical items in the data bag
  console.log("==> eventType");
  console.log(eventType);
  let dataBag={}

  if ("cpm" in data){
    data.revenue = parseFloat(data.cpm)/1000;
  }

  let device = isMobile()?'mobile':'web';
  dataBag = {
    eventType: eventType,
    originalDevice: device,
    data: data,
    targetSite: configOptions.site,
    timestamp: new Date().toISOString(),
  };

  let totalUrl = configOptions.endpoint + '?event_name=event_prebid-' + eventType.toLowerCase();
  ajax(totalUrl, (result) => utils.logInfo(`${analyticsName}Result`, result), JSON.stringify(dataBag),{
    contentType: 'application/json',
    method: 'POST'
  });
}

function isMobile() {
  return (/(ios|ipod|ipad|iphone|android)/i).test(navigator.userAgent);
}

let insticatorAnalytics = Object.assign(adapter(
  {
    defaultUrl,
    analyticsType,
    global: globalName
  }),
{
  // Override AnalyticsAdapter functions by supplying custom methods
  track({eventType, args}) {

    sendEvent(eventType, args);
  }
});

function sendBidRequest(bid) {
}

function sendBidResponse(bid) {
  if ("ad" in bid){
    delete bid["ad"];
  }
  if ("getSize" in bid){
    delete bid["getSize"];
  }
  if ("getStatusCode" in bid){
    delete bid["getStatusCode"];
  }

  sendDataEvent(CONSTANTS.EVENTS.BID_RESPONSE, bid);
}

function sendBidTimeouts(timedOutBidders) {

}

function sendBidWon(bid) {
  sendDataEvent(CONSTANTS.EVENTS.BID_WON, bid);
}

insticatorAnalytics.adapterEnableAnalytics = insticatorAnalytics.enableAnalytics;

insticatorAnalytics.enableAnalytics = function (config) {
  if (config.options.debug === undefined) {
    config.options.debug = utils.debugTurnedOn();
  }
  configOptions = config.options;

  _sampled = typeof configOptions === 'undefined' || typeof configOptions.sampling === 'undefined' ||
             Math.random() < parseFloat(configOptions.sampling);

  if (_sampled) {
  var existingEvents = events.getEvents();

  utils._each(existingEvents, function (eventObj) {
    if (typeof eventObj !== 'object') {
      return;
    }
    var args = eventObj.args;

    if (eventObj.eventType === CONSTANTS.EVENTS.BID_REQUESTED) {
      bid = args;
      sendBidRequest(bid);
    }
    else if (eventObj.eventType === CONSTANTS.EVENTS.BID_RESPONSE) {
      // bid is 2nd args
      bid = args;
      sendBidResponse(bid);
    }
    else if (eventObj.eventType === CONSTANTS.EVENTS.BID_TIMEOUT) {
      const bidderArray = args;
      sendBidTimeouts(bidderArray);
    }
    else if (eventObj.eventType === CONSTANTS.EVENTS.BID_WON) {
      bid = args;
      sendBidWon(bid);
    }
  });

  events.on(CONSTANTS.EVENTS.BID_REQUESTED, function (bidRequestObj) {
    sendBidRequest(bidRequestObj);
  });

  // bidResponses
  events.on(CONSTANTS.EVENTS.BID_RESPONSE, function (bid) {
    sendBidResponse(bid);
  });

  // bidTimeouts
  events.on(CONSTANTS.EVENTS.BID_TIMEOUT, function (bidderArray) {
    sendBidTimeouts(bidderArray);
  });

  // wins
  events.on(CONSTANTS.EVENTS.BID_WON, function (bid) {
    sendBidWon(bid);
  });

  }
  else {
    utils.logMessage('Prebid.js analytics disabled by sampling');
  }

  insticatorAnalytics.adapterEnableAnalytics(config);
};

adaptermanager.registerAnalyticsAdapter({
  adapter: insticatorAnalytics,
  code: 'insticator'
});

export default insticatorAnalytics;
