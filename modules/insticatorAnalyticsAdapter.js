import adapter from '../src/AnalyticsAdapter.js'
import adapterManager from '../src/adapterManager.js'
import CONSTANTS from '../src/constants.json'
import * as utils from '../src/utils.js'
import { ajax } from '../src/ajax.js'

const baseUrl = 'https://tr.ingage.tech/'
const ENDPOINTS = {
  AD_RENDER_FAILED: baseUrl + 'com.snowplowanalytics.iglu/v1?schema=iglu%3Acom.insticator%2Fpb_render_failed%2Fjsonschema%2F1-0-0',
}

const analyticsType = 'endpoint'
const ADAPTER_CODE = 'insticator'

const {
  AD_RENDER_FAILED
} = CONSTANTS.EVENTS

const SERVER_EVENTS = {
  AD_RENDER_FAILED: 'adRenderFailed'
}

const onAdRenderFailed = (args) => {
  let data = utils.deepClone(args)
  data.timestamp = Date.now()

  if (data.bid) {
    data = {...data, ...mapBid(data.bid, AD_RENDER_FAILED)}
  }

  sendEvent(SERVER_EVENTS.AD_RENDER_FAILED, data)
}

var insticatorAdapter = Object.assign(
  adapter({ analyticsType }), {
    track({ eventType, args }) {
      handleEvent(eventType, args)
    }
  }
)

function handleEvent(eventType, args) {
  switch (eventType) {
    case AD_RENDER_FAILED:
      onAdRenderFailed(args)
      break
  }
}

function sendEvent(eventType, args) {
  let data = utils.deepClone(args)
  Object.assign(data, {
    eventType
  })
  let endpoint
  if (eventType === SERVER_EVENTS.AD_RENDER_FAILED) {
    endpoint = ENDPOINTS.AD_RENDER_FAILED
    ajaxCall(endpoint, () => { }, JSON.stringify(data), {})
  }
}

function mapBid({
  bidStatus,
  start,
  end,
  mediaType,
  creativeId,
  originalCpm,
  originalCurrency,
  source,
  netRevenue,
  currency,
  width,
  height,
  timeToRespond,
  responseTimestamp,
  ...rest
}, eventType) {
  const bidObj = {
    bst: bidStatus,
    s: start,
    e: responseTimestamp || end,
    mt: mediaType,
    crId: creativeId,
    oCpm: originalCpm,
    oCur: originalCurrency,
    src: source,
    nrv: netRevenue,
    cur: currency,
    w: width,
    h: height,
    ttr: timeToRespond,
    ...rest,
  }

  delete bidObj['bidRequestsCount']
  delete bidObj['bidderRequestId']
  delete bidObj['bidderRequestsCount']
  delete bidObj['bidderWinsCount']
  delete bidObj['schain']
  delete bidObj['refererInfo']
  delete bidObj['statusMessage']
  delete bidObj['status']
  delete bidObj['adUrl']
  delete bidObj['ad']
  delete bidObj['usesGenericKeys']
  delete bidObj['requestTimestamp']
  return bidObj
}

function ajaxCall(endpoint, callback, data, options = {}) {
  options.contentType = 'application/json'

  return ajax(endpoint, callback, data, options)
}

insticatorAdapter.originEnableAnalytics = insticatorAdapter.enableAnalytics
insticatorAdapter.enableAnalytics = function (config) {
  // initOptions = config.options;
  insticatorAdapter.originEnableAnalytics(config)
};

adapterManager.registerAnalyticsAdapter({
  adapter: insticatorAdapter,
  code: ADAPTER_CODE
})

export default insticatorAdapter
