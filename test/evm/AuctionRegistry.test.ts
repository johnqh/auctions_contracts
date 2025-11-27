import { expect } from "chai";
import hre from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress } from "viem";

describe("AuctionRegistry", function () {
  // Fixture to deploy the contracts
  async function deployAuctionFixture() {
    const [owner, dealer, bidder1, bidder2, feeRecipient] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Deploy mock tokens
    const mockUSDC = await hre.viem.deployContract("MockERC20", ["Mock USDC", "USDC", 6]);
    const mockNFT = await hre.viem.deployContract("MockERC721", ["Mock NFT", "MNFT"]);
    const mockERC1155 = await hre.viem.deployContract("MockERC1155", ["https://example.com/"]);

    // Deploy AuctionRegistry implementation
    const AuctionRegistry = await hre.ethers.getContractFactory("AuctionRegistry");
    const auctionProxy = await hre.upgrades.deployProxy(
      AuctionRegistry,
      [owner.account.address, feeRecipient.account.address, 50], // 0.5% fee
      { kind: "uups" }
    );
    await auctionProxy.waitForDeployment();
    const auctionAddress = await auctionProxy.getAddress();

    // Get viem contract instance
    const auction = await hre.viem.getContractAt("AuctionRegistry", auctionAddress as `0x${string}`);

    // Mint tokens for testing
    const mintAmount = 1000000n * 10n ** 6n; // 1M USDC
    await mockUSDC.write.mint([dealer.account.address, mintAmount]);
    await mockUSDC.write.mint([bidder1.account.address, mintAmount]);
    await mockUSDC.write.mint([bidder2.account.address, mintAmount]);

    // Mint NFT for dealer
    await mockNFT.write.mint([dealer.account.address]);

    return {
      auction,
      mockUSDC,
      mockNFT,
      mockERC1155,
      owner,
      dealer,
      bidder1,
      bidder2,
      feeRecipient,
      publicClient,
    };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { auction } = await loadFixture(deployAuctionFixture);
      // Check via paused() which requires owner to unpause
      const isPaused = await auction.read.paused();
      expect(isPaused).to.equal(false);
    });

    it("Should set the correct fee rate", async function () {
      const { auction } = await loadFixture(deployAuctionFixture);
      const feeRate = await auction.read.feeRate();
      expect(feeRate).to.equal(50); // 0.5%
    });

    it("Should start with auction ID 1", async function () {
      const { auction } = await loadFixture(deployAuctionFixture);
      const nextId = await auction.read.nextAuctionId();
      expect(nextId).to.equal(1n);
    });
  });

  describe("Traditional Auction", function () {
    it("Should create a traditional auction", async function () {
      const { auction, mockUSDC, mockNFT, dealer, publicClient } = await loadFixture(deployAuctionFixture);

      // Approve NFT transfer
      await mockNFT.write.setApprovalForAll([auction.address, true], { account: dealer.account });

      const deadline = BigInt((await time.latest()) + 3600); // 1 hour from now

      // Create auction
      const tx = await auction.write.createTraditionalAuction(
        [
          [{
            tokenAddress: mockNFT.address,
            itemType: 1, // ERC721
            tokenId: 0n,
            amount: 1n,
          }],
          mockUSDC.address,
          100n * 10n ** 6n, // 100 USDC start
          10n * 10n ** 6n,  // 10 USDC increment
          500n * 10n ** 6n, // 500 USDC reserve
          deadline,
        ],
        { account: dealer.account }
      );

      await publicClient.waitForTransactionReceipt({ hash: tx });

      // Verify auction created
      const [core, items] = await auction.read.getAuction([1n]);
      expect(core.dealer).to.equal(getAddress(dealer.account.address));
      expect(core.auctionType).to.equal(0); // Traditional
      expect(core.status).to.equal(0); // Active
      expect(items.length).to.equal(1);
    });

    it("Should allow bidding on traditional auction", async function () {
      const { auction, mockUSDC, mockNFT, dealer, bidder1, publicClient } = await loadFixture(deployAuctionFixture);

      // Setup auction
      await mockNFT.write.setApprovalForAll([auction.address, true], { account: dealer.account });
      const deadline = BigInt((await time.latest()) + 3600);

      await auction.write.createTraditionalAuction(
        [
          [{
            tokenAddress: mockNFT.address,
            itemType: 1,
            tokenId: 0n,
            amount: 1n,
          }],
          mockUSDC.address,
          100n * 10n ** 6n,
          10n * 10n ** 6n,
          500n * 10n ** 6n,
          deadline,
        ],
        { account: dealer.account }
      );

      // Approve USDC for bidding
      await mockUSDC.write.approve([auction.address, 200n * 10n ** 6n], { account: bidder1.account });

      // Place bid
      const tx = await auction.write.bidTraditional(
        [1n, 150n * 10n ** 6n],
        { account: bidder1.account }
      );

      await publicClient.waitForTransactionReceipt({ hash: tx });

      // Verify bid
      const [core] = await auction.read.getAuction([1n]);
      expect(core.highBidder).to.equal(getAddress(bidder1.account.address));
      expect(core.currentBid).to.equal(150n * 10n ** 6n);
    });

    it("Should refund previous bidder on higher bid", async function () {
      const { auction, mockUSDC, mockNFT, dealer, bidder1, bidder2 } = await loadFixture(deployAuctionFixture);

      // Setup auction
      await mockNFT.write.setApprovalForAll([auction.address, true], { account: dealer.account });
      const deadline = BigInt((await time.latest()) + 3600);

      await auction.write.createTraditionalAuction(
        [
          [{
            tokenAddress: mockNFT.address,
            itemType: 1,
            tokenId: 0n,
            amount: 1n,
          }],
          mockUSDC.address,
          100n * 10n ** 6n,
          10n * 10n ** 6n,
          500n * 10n ** 6n,
          deadline,
        ],
        { account: dealer.account }
      );

      // Bidder1 bids
      await mockUSDC.write.approve([auction.address, 200n * 10n ** 6n], { account: bidder1.account });
      await auction.write.bidTraditional([1n, 150n * 10n ** 6n], { account: bidder1.account });

      const bidder1BalanceBefore = await mockUSDC.read.balanceOf([bidder1.account.address]);

      // Bidder2 outbids
      await mockUSDC.write.approve([auction.address, 300n * 10n ** 6n], { account: bidder2.account });
      await auction.write.bidTraditional([1n, 200n * 10n ** 6n], { account: bidder2.account });

      const bidder1BalanceAfter = await mockUSDC.read.balanceOf([bidder1.account.address]);

      // Bidder1 should be refunded
      expect(bidder1BalanceAfter - bidder1BalanceBefore).to.equal(150n * 10n ** 6n);
    });
  });

  describe("Dutch Auction", function () {
    it("Should create a dutch auction", async function () {
      const { auction, mockUSDC, mockNFT, dealer, publicClient } = await loadFixture(deployAuctionFixture);

      await mockNFT.write.setApprovalForAll([auction.address, true], { account: dealer.account });
      const deadline = BigInt((await time.latest()) + 3600);

      const tx = await auction.write.createDutchAuction(
        [
          [{
            tokenAddress: mockNFT.address,
            itemType: 1,
            tokenId: 0n,
            amount: 1n,
          }],
          mockUSDC.address,
          1000n * 10n ** 6n, // 1000 USDC start
          10n * 10n ** 6n,   // 10 USDC decrease
          60n,               // Every 60 seconds
          100n * 10n ** 6n,  // 100 USDC minimum
          deadline,
        ],
        { account: dealer.account }
      );

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const [core] = await auction.read.getAuction([1n]);
      expect(core.auctionType).to.equal(1); // Dutch
    });

    it("Should calculate correct dutch price over time", async function () {
      const { auction, mockUSDC, mockNFT, dealer } = await loadFixture(deployAuctionFixture);

      await mockNFT.write.setApprovalForAll([auction.address, true], { account: dealer.account });
      const deadline = BigInt((await time.latest()) + 3600);

      await auction.write.createDutchAuction(
        [
          [{
            tokenAddress: mockNFT.address,
            itemType: 1,
            tokenId: 0n,
            amount: 1n,
          }],
          mockUSDC.address,
          1000n * 10n ** 6n,
          10n * 10n ** 6n,
          60n,
          100n * 10n ** 6n,
          deadline,
        ],
        { account: dealer.account }
      );

      // Initial price
      let price = await auction.read.getDutchCurrentPrice([1n]);
      expect(price).to.equal(1000n * 10n ** 6n);

      // After 5 minutes (5 intervals)
      await time.increase(300);
      price = await auction.read.getDutchCurrentPrice([1n]);
      expect(price).to.equal(950n * 10n ** 6n); // 1000 - (5 * 10)
    });
  });

  describe("Penny Auction", function () {
    it("Should create a penny auction", async function () {
      const { auction, mockUSDC, mockNFT, dealer, publicClient } = await loadFixture(deployAuctionFixture);

      await mockNFT.write.setApprovalForAll([auction.address, true], { account: dealer.account });

      const tx = await auction.write.createPennyAuction(
        [
          [{
            tokenAddress: mockNFT.address,
            itemType: 1,
            tokenId: 0n,
            amount: 1n,
          }],
          mockUSDC.address,
          1n * 10n ** 6n, // 1 USDC increment
        ],
        { account: dealer.account }
      );

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const [core] = await auction.read.getAuction([1n]);
      expect(core.auctionType).to.equal(2); // Penny
    });

    it("Should allow penny bidding and reset timer", async function () {
      const { auction, mockUSDC, mockNFT, dealer, bidder1 } = await loadFixture(deployAuctionFixture);

      await mockNFT.write.setApprovalForAll([auction.address, true], { account: dealer.account });

      await auction.write.createPennyAuction(
        [
          [{
            tokenAddress: mockNFT.address,
            itemType: 1,
            tokenId: 0n,
            amount: 1n,
          }],
          mockUSDC.address,
          1n * 10n ** 6n,
        ],
        { account: dealer.account }
      );

      // Approve and bid
      await mockUSDC.write.approve([auction.address, 10n * 10n ** 6n], { account: bidder1.account });

      const dealerBalanceBefore = await mockUSDC.read.balanceOf([dealer.account.address]);

      await auction.write.bidPenny([1n], { account: bidder1.account });

      const dealerBalanceAfter = await mockUSDC.read.balanceOf([dealer.account.address]);

      // Dealer should receive payment immediately (minus fee)
      // 1 USDC * 99.5% = 0.995 USDC
      expect(dealerBalanceAfter - dealerBalanceBefore).to.equal(995000n);

      // Verify bid
      const [core] = await auction.read.getAuction([1n]);
      expect(core.highBidder).to.equal(getAddress(bidder1.account.address));
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to pause/unpause", async function () {
      const { auction, owner } = await loadFixture(deployAuctionFixture);

      await auction.write.pause({ account: owner.account });
      expect(await auction.read.paused()).to.equal(true);

      await auction.write.unpause({ account: owner.account });
      expect(await auction.read.paused()).to.equal(false);
    });

    it("Should allow owner to update fee rate", async function () {
      const { auction, owner } = await loadFixture(deployAuctionFixture);

      await auction.write.setFeeRate([100], { account: owner.account }); // 1%
      expect(await auction.read.feeRate()).to.equal(100);
    });

    it("Should reject fee rate above maximum", async function () {
      const { auction, owner } = await loadFixture(deployAuctionFixture);

      await expect(
        auction.write.setFeeRate([1001], { account: owner.account }) // 10.01%
      ).to.be.rejectedWith("fee rate too high");
    });
  });
});
