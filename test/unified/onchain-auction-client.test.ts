/**
 * Unified OnchainAuctionClient Tests
 */
import { expect } from 'chai';
import { OnchainAuctionClient } from '../../src/unified/onchain-auction-client.js';

describe('OnchainAuctionClient', function () {
  describe('Instantiation', function () {
    it('Should create a new OnchainAuctionClient instance', function () {
      const client = new OnchainAuctionClient();
      expect(client).to.be.an.instanceOf(OnchainAuctionClient);
    });

    it('Should have all required methods', function () {
      const client = new OnchainAuctionClient();

      // Read methods
      expect(client.getAuction).to.be.a('function');
      expect(client.getTraditionalParams).to.be.a('function');
      expect(client.getDutchParams).to.be.a('function');
      expect(client.getDutchCurrentPrice).to.be.a('function');
      expect(client.getPennyParams).to.be.a('function');

      // Write methods
      expect(client.createTraditionalAuction).to.be.a('function');
      expect(client.createDutchAuction).to.be.a('function');
      expect(client.createPennyAuction).to.be.a('function');
      expect(client.bidTraditional).to.be.a('function');
      expect(client.buyDutch).to.be.a('function');
      expect(client.bidPenny).to.be.a('function');
      expect(client.finalizeAuction).to.be.a('function');
      expect(client.dealerAcceptBid).to.be.a('function');
    });
  });
});
