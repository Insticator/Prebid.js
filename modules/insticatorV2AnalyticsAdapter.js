import adapter from '../libraries/analyticsAdapter/AnalyticsAdapter.js'
import adapterManager from '../src/adapterManager.js'
import CONSTANTS from '../src/constants.json'
import * as utils from '../src/utils.js'
import { ajax } from '../src/ajax.js'

const baseUrl = 'https://analysis.ingage.tech/'

const ENDPOINTS = {
    AD_RENDER_FAILED: baseUrl + 'com.snowplowanalytics.iglu/v1?schema=iglu%3Acom.insticator%2Frender_failed%2Fjsonschema%2F1-0-0',
    AD_RENDER_SUCCEEDED: baseUrl + 'com.snowplowanalytics.iglu/v1?schema=iglu%3Acom.insticator%2Frender_succeeded%2Fjsonschema%2F2-0-0',
    BID_WON: baseUrl + 'com.snowplowanalytics.iglu/v1?schema=iglu%3Acom.insticator%2Fbid_won%2Fjsonschema%2F2-0-0',
    AUCTION_END: baseUrl + 'com.snowplowanalytics.iglu/v1?schema=iglu%3Acom.insticator%2Fauction_end%2Fjsonschema%2F1-0-0'
}

const analyticsType = 'endpoint'
const ADAPTER_CODE = 'insticatorV2'

const {
    AUCTION_INIT,
    BID_REQUESTED,
    BID_RESPONSE,
    BID_WON,
    AUCTION_END,
    AD_RENDER_FAILED,
    AD_RENDER_SUCCEEDED
} = CONSTANTS.EVENTS

const SERVER_EVENTS = {
    AD_RENDER_FAILED: 'adRenderFailed',
    AD_RENDER_SUCCEEDED: 'adRenderSucceeded',
    WON: 'bidWon',
    AUCTION_END: 'auctionEnd'
}

const SERVER_BID_STATUS = {
    BID_REQUESTED: 'bidRequested',
    BID_RECEIVED: 'bidReceived',
    BID_WON: 'bidWon',
    AUCTION_END: 'auctionEnd'
}

let auctions = {}

const onAuctionInit = (args) => {
    const { auctionId, adUnits, timestamp } = args

    let auction = auctions[auctionId] = {
        ...args,
        adUnits: {},
        auctionStart: timestamp
    }

    utils._each(adUnits, adUnit => {
        auction.adUnits[adUnit.code] = {
            ...adUnit,
            auctionId,
            adunid: adUnit.code,
            bids: {},
        }
    })
}

const onBidRequested = (args) => {
    const { auctionId, bids, start, timeout } = args
    const _start = start || Date.now()
    const auction = auctions[auctionId]
    const auctionAdUnits = auction.adUnits

    bids.forEach(bid => {
        const { adUnitCode } = bid
        const bidId = parseBidId(bid)

        auctionAdUnits[adUnitCode].bids[bidId] = {
            ...bid,
            timeout,
            start: _start,
            rs: _start - auction.auctionStart,
            bidStatus: SERVER_BID_STATUS.BID_REQUESTED,
        }
    })
}

const onBidResponse = (args) => {
    const { auctionId, adUnitCode } = args
    const auction = auctions[auctionId]
    const bidId = parseBidId(args)
    let bid = auction.adUnits[adUnitCode].bids[bidId]

    Object.assign(bid, args, {
        bidStatus: SERVER_BID_STATUS.BID_RECEIVED,
        end: args.responseTimestamp,
        re: args.responseTimestamp - auction.auctionStart
    })
}

const onAuctionEnd = (args) => {
    const { auctionId, auctionStatus, auctionEnd } = args
    let auction = auctions[args.auctionId];

    for (const key in auction.adUnits) {
        auction.adUnits[key].bids = Object.values(auction.adUnits[key].bids).map((bid) => { return mapBid(bid) });
    }

    const payload = {
        auctionId,
        auctionDuration: auctionEnd - auction.auctionStart,
        auctionStatus,
        adUnits: Object.values(auction.adUnits)
    }
    sendEvent(SERVER_EVENTS.AUCTION_END, payload)
}

const onBidWon = (args) => {
    const { auctionId, adUnitCode } = args
    const bidId = parseBidId(args)
    const bid = auctions[auctionId].adUnits[adUnitCode].bids.find((bid) => {
        return bid.bidId == bidId;
    });

    Object.assign(bid, args, {
        bidStatus: SERVER_BID_STATUS.BID_WON,
        isW: true,
        isH: true
    })

    const payload = {
        auctionId,
        adunid: adUnitCode,
        bid: mapBid(bid, BID_WON)
    }
    sendEvent(SERVER_EVENTS.WON, payload)
}

const onAdRenderFailed = (args) => {
    const { bid } = args
    let data = {
        timestamp: Date.now()
    }

    if (bid) {
        data.bid = mapBid(bid, AD_RENDER_FAILED)
    }

    sendEvent(SERVER_EVENTS.AD_RENDER_FAILED, data)
}

const onAdRenderSucceeded = (args) => {
    const { bid } = args
    let data = {
        timestamp: Date.now()
    }

    if (bid) {
        data.bid = mapBid(bid, AD_RENDER_SUCCEEDED)
    }

    sendEvent(SERVER_EVENTS.AD_RENDER_SUCCEEDED, data)
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
        case AUCTION_INIT:
            onAuctionInit(args)
            break
        case BID_REQUESTED:
            onBidRequested(args)
            break
        case BID_RESPONSE:
            onBidResponse(args)
            break
        case BID_WON:
            onBidWon(args)
            break
        case AUCTION_END:
            onAuctionEnd(args)
            break
        case AD_RENDER_FAILED:
            onAdRenderFailed(args)
            break
        case AD_RENDER_SUCCEEDED:
            onAdRenderSucceeded(args)
            break
    }
}

function sendEvent(eventType, data) {
    let payload = {
        eventType,
        domain: window.location.hostname
    }
    if (data.bid) {
        payload.bid = data.bid
    }
    if (data.timestamp) {
        payload.timestamp = data.timestamp
    }
    if (data.auctionId) {
        payload.auctionId = data.auctionId
    }
    if (data.adunid) {
        payload.adunid = data.adunid
    }
    if (data.auctionDuration) {
        payload.auctionDuration = data.auctionDuration
    }
    if (data.auctionStatus) {
        payload.auctionStatus = data.auctionStatus
    }
    if (data.adUnits) {
        payload.adUnits = data.adUnits
    }
    let endpoint
    if (eventType === SERVER_EVENTS.AD_RENDER_FAILED) {
        endpoint = ENDPOINTS.AD_RENDER_FAILED
    } else if (eventType === SERVER_EVENTS.WON) {
        endpoint = ENDPOINTS.BID_WON
    } else if (eventType === SERVER_EVENTS.AD_RENDER_SUCCEEDED) {
        endpoint = ENDPOINTS.AD_RENDER_SUCCEEDED
    } else if (eventType === SERVER_EVENTS.AUCTION_END) {
        endpoint = ENDPOINTS.AUCTION_END
    }
    if (endpoint) {
        ajaxCall(endpoint, () => { }, JSON.stringify(payload), {})
    }
}

function parseBidId(bid) {
    return bid.bidId || bid.requestId
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
    delete bidObj['pbAg']
    delete bidObj['pbCg']
    delete bidObj['pbDg']
    delete bidObj['pbLg']
    delete bidObj['pbHg']
    delete bidObj['pbMg']
    delete bidObj['adserverTargeting']
    delete bidObj['ortb2Imp']
    return bidObj
}

function ajaxCall(endpoint, callback, data, options = {}) {
    options.contentType = 'application/json'

    return ajax(endpoint, callback, data, options)
}

insticatorAdapter.originEnableAnalytics = insticatorAdapter.enableAnalytics
insticatorAdapter.enableAnalytics = function (config) {
    insticatorAdapter.originEnableAnalytics(config)
};

insticatorAdapter.originDisableAnalytics = insticatorAdapter.disableAnalytics
insticatorAdapter.disableAnalytics = function () {
    auctions = {}
    insticatorAdapter.originDisableAnalytics()
}

adapterManager.registerAnalyticsAdapter({
    adapter: insticatorAdapter,
    code: ADAPTER_CODE
})

export default insticatorAdapter
