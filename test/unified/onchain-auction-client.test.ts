/**
 * Unified OnchainAuctionClient Tests
 */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import { OnchainAuctionClient } from '../../src/unified/onchain-auction-client.js';
import {
  AuctionType,
  AuctionStatus,
  calculateFee,
  formatAuctionType,
  formatAuctionStatus,
  validateTraditionalParams,
  validateDutchParams,
  validatePennyParams,
  validateTraditionalBid,
  calculateDutchPrice,
  calculateTimeRemaining,
  formatAmount,
  parseAmount,
  type DutchParams,
  type TraditionalParams,
} from '../../src/types/common.js';

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

describe('Common Types and Utilities', function () {
  describe('calculateFee', function () {
    it('Should calculate 0.5% fee correctly', function () {
      const { fee, netAmount } = calculateFee(10000n);
      expect(fee).to.equal(50n);
      expect(netAmount).to.equal(9950n);
    });

    it('Should handle small amounts', function () {
      const { fee, netAmount } = calculateFee(100n);
      expect(fee).to.equal(0n); // 0.5% of 100 = 0.5, rounds to 0
      expect(netAmount).to.equal(100n);
    });

    it('Should handle custom fee rate', function () {
      const { fee, netAmount } = calculateFee(10000n, 100n); // 1%
      expect(fee).to.equal(100n);
      expect(netAmount).to.equal(9900n);
    });
  });

  describe('Format Functions', function () {
    it('Should format auction types', function () {
      expect(formatAuctionType(AuctionType.Traditional)).to.equal('Traditional');
      expect(formatAuctionType(AuctionType.Dutch)).to.equal('Dutch');
      expect(formatAuctionType(AuctionType.Penny)).to.equal('Penny');
    });

    it('Should format auction statuses', function () {
      expect(formatAuctionStatus(AuctionStatus.Active)).to.equal('Active');
      expect(formatAuctionStatus(AuctionStatus.Expired)).to.equal('Expired');
      expect(formatAuctionStatus(AuctionStatus.Finalized)).to.equal('Finalized');
      expect(formatAuctionStatus(AuctionStatus.Refunded)).to.equal('Refunded');
    });
  });

  describe('Validation Functions', function () {
    it('Should validate Traditional auction params', function () {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const result = validateTraditionalParams({
        startAmount: 100n,
        increment: 10n,
        reservePrice: 200n,
        deadline: futureDeadline,
      });
      expect(result.valid).to.be.true;
      expect(result.errors).to.have.length(0);
    });

    it('Should reject invalid Traditional auction params', function () {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 3600);
      const result = validateTraditionalParams({
        startAmount: 0n,
        increment: -1n,
        reservePrice: 50n,
        deadline: pastDeadline,
      });
      expect(result.valid).to.be.false;
      expect(result.errors.length).to.be.greaterThan(0);
    });

    it('Should validate Dutch auction params', function () {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const result = validateDutchParams({
        startPrice: 1000n,
        decreaseAmount: 10n,
        decreaseInterval: 60n,
        minimumPrice: 100n,
        deadline: futureDeadline,
      });
      expect(result.valid).to.be.true;
    });

    it('Should validate Penny auction params', function () {
      const result = validatePennyParams({
        incrementAmount: 100n,
        timerDuration: 300n,
      });
      expect(result.valid).to.be.true;
    });

    it('Should validate Traditional bid', function () {
      const params: TraditionalParams = {
        startAmount: 100n,
        increment: 10n,
        reservePrice: 200n,
        acceptanceDeadline: 0n,
        reserveMet: false,
      };

      // First bid should be at least startAmount
      let result = validateTraditionalBid(0n, 100n, params);
      expect(result.valid).to.be.true;

      // Subsequent bid should be at least current + increment
      result = validateTraditionalBid(100n, 110n, params);
      expect(result.valid).to.be.true;

      // Bid too low
      result = validateTraditionalBid(100n, 105n, params);
      expect(result.valid).to.be.false;
    });
  });

  describe('Dutch Price Calculation', function () {
    it('Should calculate correct Dutch price', function () {
      const startTime = BigInt(Math.floor(Date.now() / 1000));
      const params: DutchParams = {
        startPrice: 1000n,
        decreaseAmount: 10n,
        decreaseInterval: 60n,
        minimumPrice: 100n,
        startTime,
      };

      // At start, price should be startPrice
      expect(calculateDutchPrice(params, startTime)).to.equal(1000n);

      // After 1 interval, price should decrease by 10
      expect(calculateDutchPrice(params, startTime + 60n)).to.equal(990n);

      // After 5 intervals, price should decrease by 50
      expect(calculateDutchPrice(params, startTime + 300n)).to.equal(950n);

      // Price should not go below minimum
      expect(calculateDutchPrice(params, startTime + 100000n)).to.equal(100n);
    });
  });

  describe('Time Remaining', function () {
    it('Should calculate time remaining', function () {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 90061); // ~1 day 1 hr 1 min 1 sec
      const result = calculateTimeRemaining(futureDeadline);

      expect(result.expired).to.be.false;
      expect(result.days).to.equal(1n);
      expect(result.hours).to.equal(1n);
      expect(result.minutes).to.equal(1n);
    });

    it('Should handle expired deadline', function () {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 3600);
      const result = calculateTimeRemaining(pastDeadline);

      expect(result.expired).to.be.true;
      expect(result.total).to.equal(0n);
    });
  });

  describe('Amount Formatting', function () {
    it('Should format amounts with decimals', function () {
      expect(formatAmount(1000000n, 6)).to.equal('1');
      expect(formatAmount(1500000n, 6)).to.equal('1.5');
      expect(formatAmount(1234567n, 6)).to.equal('1.234567');
      expect(formatAmount(123n, 6)).to.equal('0.000123');
    });

    it('Should parse amount strings', function () {
      expect(parseAmount('1', 6)).to.equal(1000000n);
      expect(parseAmount('1.5', 6)).to.equal(1500000n);
      expect(parseAmount('1.234567', 6)).to.equal(1234567n);
      expect(parseAmount('0.000123', 6)).to.equal(123n);
    });
  });
});
