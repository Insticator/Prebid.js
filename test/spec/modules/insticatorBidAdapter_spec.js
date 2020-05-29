import { expect } from 'chai';
import * as utils from 'src/utils.js';
import { spec } from 'modules/insticatorBidAdapter.js';

describe('Insticator bid adapter', () => {
  const bidderRequestWithGDPR = {
    auctionId: 'ccaabb112233',
    bidderRequestId: '123d12231aa',
    timeout: 200,
    refererInfo: {
      referer: 'http://domain.com/foo',
    },
    gdprConsent: {
      gdprApplies: 1,
      consentString: 'foobar',
    },
  };

  const validBid = {
    bidder: 'insticator',
    params: {
      adUnitId: '123456',
    },
    sizes: [
      [300, 250],
      [300, 600],
    ],
    mediaTypes: {
      banner: {
        sizes: [
          [300, 250],
          [300, 600],
        ],
      },
    },
    adUnitCode: 'div-gpt-ad-837465923534-0',
    transactionId: 'f160fc1d-3db4-4dbe-ab1d-b2814e5c2d57',
    bidId: '1234abcd',
    bidderRequestId: '123d12231aa',
    auctionId: 'ccaabb112233',
  };

  const validBid2 = {
    bidder: 'insticator',
    params: {
      adUnitId: '234567',
    },
    sizes: [[300, 600]],
    mediaTypes: {
      banner: {
        sizes: [[300, 600]],
      },
    },
    adUnitCode: 'div-gpt-ad-4645345744-0',
    transactionId: 'b47af70a-cecd-4974-8a01-50721d6033cb',
    bidId: '2345abcd',
    bidderRequestId: '123d12231aa',
    auctionId: 'ccaabb112233',
  };

  const bidderRequest = {
    auctionId: 'ccaabb112233',
    bidderRequestId: '123d12231aa',
    timeout: 200,
    refererInfo: {
      referer: 'http://domain.com/foo',
    },
    bids: [validBid, validBid2],
  };

  const validResponse = {
    id: '123d12231aa',
    seatbid: [
      {
        seat: 'insticator',
        group: 0,
        bid: [
          {
            id: 'bid123456',
            w: 300,
            h: 250,
            impid: '1234abcd',
            price: 0.5,
            crid: '987654321',
            adm: '<div>ad</div>',
          },
        ],
      },
    ],
    ext: {
      sync: [
        {
          type: 'image',
          url: 'http://ex.ingage.tech/sync/1234567',
        },
      ],
    },
  };

  describe('isBidRequestValid()', () => {
    it('should return true when required params found', () => {
      expect(spec.isBidRequestValid(validBid)).to.equal(true);
    });

    it('should return true when mediaTypes.banner.sizes are missing, but sizes are specified', () => {
      const bid = utils.deepClone(validBid);
      delete bid.mediaTypes.banner.sizes;

      expect(spec.isBidRequestValid(bid)).to.equal(true);
    });

    it('should return true when sizes are missing, but mediaTypes.banner.sizes are specified', () => {
      const bid = utils.deepClone(validBid);
      delete bid.sizes;

      expect(spec.isBidRequestValid(bid)).to.equal(true);
    });

    it('should return false when adUnitId is not defined', () => {
      const bid = utils.deepClone(validBid);
      delete bid.params.adUnitId;

      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });

    it('should return false when there is no banner in mediaTypes', () => {
      const bid = utils.deepClone(validBid);
      delete bid.mediaTypes.banner;

      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });

    it('should return false when sizes are not specified', () => {
      const bid = utils.deepClone(validBid);
      delete bid.sizes;
      delete bid.mediaTypes.banner.sizes;

      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });

    it('should return false when sizes are invalid', () => {
      const bid = utils.deepClone(validBid);
      delete bid.mediaTypes.banner.sizes;

      bid.sizes = [['123', 'foo']];

      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });
  });

  describe('buildRequests()', () => {
    it('should build correct request', () => {
      const requests = spec.buildRequests([validBid, validBid2], bidderRequest);

      expect(requests).to.have.lengthOf(1);
      expect(requests[0]).to.deep.include({
        method: 'POST',
        url: 'https://ex.hunchme.com/v1/openrtb',
        options: {
          contentType: 'application/json',
          withCredentials: true,
        },
      });

      expect(JSON.parse(requests[0].data)).to.deep.include({
        id: '123d12231aa',
        device: {
          ext: {
            cookies: true,
            localStorage: true,
          },
          js: true,
          w: 100,
          h: 100,
        },
        source: {
          fd: 1,
          tid: 'ccaabb112233',
        },
        tmax: 200,
        imp: [
          {
            banner: {
              format: [
                {
                  w: 300,
                  h: 250,
                },
                {
                  w: 300,
                  h: 600,
                },
              ],
            },
            ext: {
              insticator: {
                adUnitId: '123456',
              },
            },
            id: '1234abcd',
            tagid: 'div-gpt-ad-837465923534-0',
          },
          {
            banner: {
              format: [
                {
                  w: 300,
                  h: 600,
                },
              ],
            },
            ext: {
              insticator: {
                adUnitId: '234567',
              },
            },
            id: '2345abcd',
            tagid: 'div-gpt-ad-4645345744-0',
          },
        ],
      });
    });

    it('should include in request GDPR options if available', () => {
      const requests = spec.buildRequests(
        [validBid, validBid2],
        bidderRequestWithGDPR
      );

      expect(JSON.parse(requests[0].data)).to.deep.include({
        regs: {
          ext: {
            gdpr: 1,
            gdprConsentString: 'foobar',
          },
        },
      });
    });

    it('should generate and pass user id', () => {
      localStorage.removeItem('hb_insticator_uid');
      utils.setCookie('hb_insticator_uid');

      const requests = spec.buildRequests([validBid, validBid2], bidderRequest);
      const rtbRequest = JSON.parse(requests[0].data);

      expect(rtbRequest.user.id).to.have.lengthOf(36);
    });

    it('should pass user id if available', () => {
      localStorage.setItem(
        'hb_insticator_uid',
        '77016c8d-6c6e-40cb-8801-1060089b5c60'
      );

      const requests = spec.buildRequests([validBid, validBid2], bidderRequest);
      const rtbRequest = JSON.parse(requests[0].data);

      expect(rtbRequest.user.id).to.equal(
        '77016c8d-6c6e-40cb-8801-1060089b5c60'
      );
    });

    it('should regenerate user id if it is invalid', () => {
      localStorage.setItem('hb_insticator_uid', 'foo');

      const requests = spec.buildRequests([validBid, validBid2], bidderRequest);
      const rtbRequest = JSON.parse(requests[0].data);

      expect(rtbRequest.user.id).to.have.lengthOf(36);
    });
  });

  describe('interpretResponse()', () => {
    it('should correctly interpret valid response', () => {
      const bids = spec.interpretResponse(
        { body: validResponse },
        { bidderRequest }
      );

      expect(bids).to.deep.equal([
        {
          requestId: '1234abcd',
          width: 300,
          height: 250,
          ttl: 300,
          cpm: 0.5,
          currency: 'USD',
          creativeId: '987654321',
          mediaType: 'banner',
          netRevenue: true,
          adUnitCode: 'div-gpt-ad-837465923534-0',
          ad: '<div>ad</div>',
        },
      ]);
    });

    it('should return not bids if response id does not match bidderRequestId', () => {
      const body = utils.deepClone(validResponse);
      body.id = '123';

      const bids = spec.interpretResponse({ body }, { bidderRequest });

      expect(bids).to.deep.equal([]);
    });

    it('should return not bids if response does not include seatbid', () => {
      const body = utils.deepClone(validResponse);
      delete body.seatbid;

      const bids = spec.interpretResponse({ body }, { bidderRequest });

      expect(bids).to.deep.equal([]);
    });

    it('should return not bids if response does not include any bids', () => {
      const body = utils.deepClone(validResponse);
      body.seatbid = [];

      const bids = spec.interpretResponse({ body }, { bidderRequest });

      expect(bids).to.deep.equal([]);
    });
  });

  describe('getUserSyncs()', () => {
    it('should return user syncs if there are included in the response', () => {
      const syncs = spec.getUserSyncs({}, [{ body: validResponse }]);

      expect(syncs).to.deep.equal([
        {
          type: 'image',
          url: 'http://ex.ingage.tech/sync/1234567',
        },
      ]);
    });
  });
});
