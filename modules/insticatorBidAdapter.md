Overview
========

```
Module Name: Insticator Adapter
Module Type: Bidder Adapter
Maintainer: contact@insticator.com
```

Description
===========

This module connects publishers to Insticator exchange of demand sources through Prebid.js. 

### First Party Data

An `ext` set by the publisher is forwarded on every ORTB object. For the media
type objects both `mediaTypes.<mediaType>.ext` and `ortb2Imp.<mediaType>.ext` are
read, the latter taking precedence, and for banner these are the only two sources.

### Supported Media Types

| Type | Support
| --- | ---
| Banner | Fully supported for all approved sizes.
| Video | Fully supported.
| Audio | Fully supported.

# Bid Parameters

Each of the Insticator-specific parameters provided under the `adUnits[].bids[].params`
object are detailed here.

### Common

Apply to every media type.

| Key | Scope | Type | Description
| --- | --- | --- | ---
| adUnitId | Required | String | The ad unit ID provided by Insticator.
| publisherId | Optional | String | The publisher ID provided by Insticator. Also sent as a `publisherId` query parameter.
| floor | Optional | Float | Bid floor for this impression, in USD.
| bidfloorcur | Optional | String | Floor currency. Only `USD` is supported; any other value drops both `floor` and `bidfloorcur`.
| bid_endpoint_request_url | Optional | String | Overrides the endpoint the adapter posts to.

### User

Supplied under `params.user`. `yob`, `gender` and `keywords` are read from these
parameters only. `data` is concatenated with anything set on `ortb2.user.data`,
and `ext` is merged with `ortb2.user.ext`, the bidder parameter winning where the
two name the same key.

| Key | Scope | Type | Description
| --- | --- | --- | ---
| yob | Optional | Integer | Year of birth.
| gender | Optional | String | `M`, `F` or `O`.
| keywords | Optional | String | Comma separated keywords.
| data | Optional | Array | OpenRTB `user.data` segments. Concatenated after any set on `ortb2.user.data`.
| ext | Optional | Object | Merged under `user.ext`, taking precedence over `ortb2.user.ext`.

### Video

Supplied under `params.video`. Every key is optional and is dropped if it fails
validation. Where the same field is set in more than one place the order is
`mediaTypes.video`, then `ortb2Imp.video`, then `params.video`, so a bidder
parameter wins.

`minduration`, `maxduration`, `protocols`, `startdelay`, `linearity`, `skip`,
`skipmin`, `skipafter`, `sequence`, `battr`, `maxextended`, `minbitrate`,
`maxbitrate`, `playbackmethod`, `playbackend`, `delivery`, `pos`, `api`,
`podid`, `podseq`, `poddur`, `slotinpod`, `mincpmpersec`, `maxseq`, `rqddurs`,
`ext`

### Audio

Supplied under `params.audio`. Every key is optional and is dropped if it fails
validation. Where the same field is set in more than one place the order is
`mediaTypes.audio`, then `ortb2Imp.audio`, then `params.audio`, so a bidder
parameter wins.

`mimes`, `minduration`, `maxduration`, `poddur`, `protocols`, `startdelay`,
`rqddurs`, `podid`, `podseq`, `sequence`, `slotinpod`, `mincpmpersec`, `battr`,
`maxextended`, `minbitrate`, `maxbitrate`, `delivery`, `companionad`, `api`,
`companiontype`, `maxseq`, `feed`, `stitched`, `nvol`, `durfloors`, `ext`


# Test Parameters

### Banner
```
    var adUnits = [
           {
               code: 'test-div',
               mediaTypes: {
                   banner: {
                       sizes: [[300, 250], [300, 600]]
                   }
               },
               bids: [
                   {
                       bidder: 'insticator',
                       params: {
                           adUnitId: 'test'
                       }
                   }
               ]
           }
	]
```

### Video
```
    var adUnits = [
           {
               code: 'test-video-div',
               mediaTypes: {
                   video: {
                       playerSize: [[640, 480]],
                       mimes: ['video/mp4'],
                       plcmt: 1,
                       minduration: 1,
                       maxduration: 30
                   }
               },
               bids: [
                   {
                       bidder: 'insticator',
                       params: {
                           adUnitId: 'test'
                       }
                   }
               ]
           }
	]
```

### Audio
```
    var adUnits = [
           {
               code: 'test-audio-div',
               mediaTypes: {
                   audio: {
                       mimes: ['audio/mp4', 'audio/mpeg'],
                       minduration: 5,
                       maxduration: 30,
                       feed: 3,
                       stitched: 0,
                       nvol: 1
                   }
               },
               bids: [
                   {
                       bidder: 'insticator',
                       params: {
                           adUnitId: 'test'
                       }
                   }
               ]
           }
	]
```
