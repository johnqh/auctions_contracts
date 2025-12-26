/**
 * EVM Auction Usage Examples
 *
 * This file demonstrates how to use the auction contract on EVM chains.
 * Before running, ensure you have:
 * 1. Deployed the contract (see scripts/evm/deploy.ts)
 * 2. Set up environment variables (PRIVATE_KEY, RPC_URL)
 */

import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { OnchainAuctionClient } from '../src/unified/onchain-auction-client.js';
import {
  ChainType,
  ItemType,
  AuctionStatus,
  type ChainInfo,
  type AuctionItem,
  formatAuctionType,
  formatAuctionStatus,
  formatAmount,
  parseAmount,
  calculateTimeRemaining,
  validateTraditionalParams,
  validateDutchParams,
} from '../src/types/common.js';

// Configuration (update these values)
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const CONTRACT_ADDRESS = process.env.AUCTION_CONTRACT_ADDRESS as Address;
const PAYMENT_TOKEN = process.env.PAYMENT_TOKEN_ADDRESS as Address; // ERC-20 token for payments
const NFT_ADDRESS = process.env.NFT_ADDRESS as Address; // ERC-721 for auction items

// Setup clients
const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(),
});

// Chain configuration
const chainInfo: ChainInfo = {
  chainType: ChainType.EVM,
  chainId: sepolia.id,
  rpcUrl: sepolia.rpcUrls.default.http[0],
  contractAddress: CONTRACT_ADDRESS,
};

// Create auction client
const auctionClient = new OnchainAuctionClient();

// Wallet object for the client
const wallet = {
  walletClient,
  publicClient,
  address: account.address,
};

/**
 * Example 1: Create a Traditional Auction for an NFT
 */
export async function createTraditionalAuctionExample() {
  console.log('\n=== Creating Traditional Auction ===\n');

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 7 days from now

  const params = {
    items: [
      {
        tokenAddress: NFT_ADDRESS,
        itemType: ItemType.ERC721,
        tokenId: 1n,
        amount: 1n,
      },
    ],
    paymentToken: PAYMENT_TOKEN,
    startAmount: parseAmount('10', 18), // 10 tokens minimum first bid
    increment: parseAmount('1', 18), // 1 token minimum increment
    reservePrice: parseAmount('100', 18), // 100 tokens reserve
    deadline,
  };

  // Validate parameters before submitting
  const validation = validateTraditionalParams({
    startAmount: params.startAmount,
    increment: params.increment,
    reservePrice: params.reservePrice,
    deadline: params.deadline,
  });

  if (!validation.valid) {
    console.error('Invalid parameters:', validation.errors);
    return;
  }

  console.log('Parameters:');
  console.log('  Start Amount:', formatAmount(params.startAmount, 18), 'tokens');
  console.log('  Increment:', formatAmount(params.increment, 18), 'tokens');
  console.log('  Reserve Price:', formatAmount(params.reservePrice, 18), 'tokens');

  const timeRemaining = calculateTimeRemaining(deadline);
  console.log('  Duration:', `${timeRemaining.days}d ${timeRemaining.hours}h`);

  // NOTE: Before creating auction, you need to approve NFT transfer
  // await nftContract.setApprovalForAll(CONTRACT_ADDRESS, true);

  const result = await auctionClient.createTraditionalAuction(wallet, chainInfo, params);

  console.log('\nAuction created!');
  console.log('  Transaction:', result.txHash);
  console.log('  Auction ID:', result.auctionId?.toString());

  return result.auctionId;
}

/**
 * Example 2: Create a Dutch Auction
 */
export async function createDutchAuctionExample() {
  console.log('\n=== Creating Dutch Auction ===\n');

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60); // 24 hours

  const params = {
    items: [
      {
        tokenAddress: NFT_ADDRESS,
        itemType: ItemType.ERC721,
        tokenId: 2n,
        amount: 1n,
      },
    ],
    paymentToken: PAYMENT_TOKEN,
    startPrice: parseAmount('1000', 18), // Start at 1000 tokens
    decreaseAmount: parseAmount('10', 18), // Decrease by 10 tokens
    decreaseInterval: 3600n, // Every hour
    minimumPrice: parseAmount('100', 18), // Floor at 100 tokens
    deadline,
  };

  // Validate parameters
  const validation = validateDutchParams({
    startPrice: params.startPrice,
    decreaseAmount: params.decreaseAmount,
    decreaseInterval: params.decreaseInterval,
    minimumPrice: params.minimumPrice,
    deadline: params.deadline,
  });

  if (!validation.valid) {
    console.error('Invalid parameters:', validation.errors);
    return;
  }

  console.log('Parameters:');
  console.log('  Start Price:', formatAmount(params.startPrice, 18), 'tokens');
  console.log('  Decrease:', formatAmount(params.decreaseAmount, 18), 'tokens per hour');
  console.log('  Minimum Price:', formatAmount(params.minimumPrice, 18), 'tokens');

  const result = await auctionClient.createDutchAuction(wallet, chainInfo, params);

  console.log('\nDutch auction created!');
  console.log('  Transaction:', result.txHash);
  console.log('  Auction ID:', result.auctionId?.toString());

  return result.auctionId;
}

/**
 * Example 3: Create a Penny Auction
 */
export async function createPennyAuctionExample() {
  console.log('\n=== Creating Penny Auction ===\n');

  const params = {
    items: [
      {
        tokenAddress: NFT_ADDRESS,
        itemType: ItemType.ERC721,
        tokenId: 3n,
        amount: 1n,
      },
    ],
    paymentToken: PAYMENT_TOKEN,
    incrementAmount: parseAmount('0.1', 18), // 0.1 tokens per bid
  };

  console.log('Parameters:');
  console.log('  Bid Cost:', formatAmount(params.incrementAmount, 18), 'tokens');
  console.log('  Timer: 5 minutes (resets on each bid)');

  const result = await auctionClient.createPennyAuction(wallet, chainInfo, params);

  console.log('\nPenny auction created!');
  console.log('  Transaction:', result.txHash);
  console.log('  Auction ID:', result.auctionId?.toString());

  return result.auctionId;
}

/**
 * Example 4: Place a Bid on Traditional Auction
 */
export async function bidOnTraditionalAuction(auctionId: bigint) {
  console.log('\n=== Placing Bid on Traditional Auction ===\n');
  console.log('Auction ID:', auctionId.toString());

  // Get current auction state
  const { core } = await auctionClient.getAuction(chainInfo, auctionId, publicClient);

  console.log('Current State:');
  console.log('  Status:', formatAuctionStatus(core.status));
  console.log('  Current Bid:', formatAmount(core.currentBid, 18), 'tokens');
  console.log('  High Bidder:', core.highBidder);

  if (core.status !== AuctionStatus.Active) {
    console.log('Auction is not active, cannot bid');
    return;
  }

  // Get parameters to determine minimum bid
  const params = await auctionClient.getTraditionalParams(chainInfo, auctionId, publicClient);
  const minBid = core.currentBid === 0n ? params.startAmount : core.currentBid + params.increment;

  console.log('  Minimum Next Bid:', formatAmount(minBid, 18), 'tokens');

  // Bid 10% above minimum
  const bidAmount = (minBid * 110n) / 100n;
  console.log('\nPlacing bid:', formatAmount(bidAmount, 18), 'tokens');

  // NOTE: Before bidding, you need to approve the payment token
  // await paymentToken.approve(CONTRACT_ADDRESS, bidAmount);

  const result = await auctionClient.bidTraditional(wallet, chainInfo, auctionId, bidAmount);

  console.log('Bid placed!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 5: Buy from Dutch Auction
 */
export async function buyFromDutchAuction(auctionId: bigint) {
  console.log('\n=== Buying from Dutch Auction ===\n');
  console.log('Auction ID:', auctionId.toString());

  // Get current price
  const currentPrice = await auctionClient.getDutchCurrentPrice(chainInfo, auctionId, publicClient);
  console.log('Current Price:', formatAmount(currentPrice, 18), 'tokens');

  // Get auction details
  const { core } = await auctionClient.getAuction(chainInfo, auctionId, publicClient);

  if (core.status !== AuctionStatus.Active) {
    console.log('Auction is not active');
    return;
  }

  const timeRemaining = calculateTimeRemaining(core.deadline);
  if (timeRemaining.expired) {
    console.log('Auction has expired');
    return;
  }

  console.log('Time Remaining:', `${timeRemaining.hours}h ${timeRemaining.minutes}m`);

  // NOTE: Before buying, you need to approve the payment token
  // await paymentToken.approve(CONTRACT_ADDRESS, currentPrice);

  const result = await auctionClient.buyDutch(wallet, chainInfo, auctionId);

  console.log('\nPurchase complete!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 6: Place Bid on Penny Auction
 */
export async function bidOnPennyAuction(auctionId: bigint) {
  console.log('\n=== Placing Bid on Penny Auction ===\n');
  console.log('Auction ID:', auctionId.toString());

  // Get auction state
  const { core } = await auctionClient.getAuction(chainInfo, auctionId, publicClient);
  const params = await auctionClient.getPennyParams(chainInfo, auctionId, publicClient);

  console.log('Bid Cost:', formatAmount(params.incrementAmount, 18), 'tokens');
  console.log('Total Paid So Far:', formatAmount(params.totalPaid, 18), 'tokens');
  console.log('Current Leader:', core.highBidder);

  if (params.lastBidTime > 0n) {
    const timeRemaining = calculateTimeRemaining(
      params.lastBidTime + params.timerDuration
    );
    console.log('Time Until Win:', `${timeRemaining.minutes}m ${timeRemaining.seconds}s`);
  }

  // NOTE: Before bidding, you need to approve the increment amount
  // await paymentToken.approve(CONTRACT_ADDRESS, params.incrementAmount);

  const result = await auctionClient.bidPenny(wallet, chainInfo, auctionId);

  console.log('\nBid placed!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 7: Finalize an Auction
 */
export async function finalizeAuction(auctionId: bigint) {
  console.log('\n=== Finalizing Auction ===\n');
  console.log('Auction ID:', auctionId.toString());

  const { core } = await auctionClient.getAuction(chainInfo, auctionId, publicClient);

  console.log('Type:', formatAuctionType(core.auctionType));
  console.log('Status:', formatAuctionStatus(core.status));
  console.log('Winner:', core.highBidder);
  console.log('Final Price:', formatAmount(core.currentBid, 18), 'tokens');

  const result = await auctionClient.finalizeAuction(wallet, chainInfo, auctionId);

  console.log('\nAuction finalized!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 8: Dealer Accepts Bid Below Reserve
 */
export async function dealerAcceptBid(auctionId: bigint) {
  console.log('\n=== Dealer Accepting Bid Below Reserve ===\n');
  console.log('Auction ID:', auctionId.toString());

  const { core } = await auctionClient.getAuction(chainInfo, auctionId, publicClient);
  const params = await auctionClient.getTraditionalParams(chainInfo, auctionId, publicClient);

  console.log('Current Bid:', formatAmount(core.currentBid, 18), 'tokens');
  console.log('Reserve Price:', formatAmount(params.reservePrice, 18), 'tokens');
  console.log('Reserve Met:', params.reserveMet);

  if (params.reserveMet) {
    console.log('Reserve already met, use finalizeAuction instead');
    return;
  }

  // Check acceptance window
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now > params.acceptanceDeadline) {
    console.log('Acceptance window expired');
    return;
  }

  const timeRemaining = calculateTimeRemaining(params.acceptanceDeadline);
  console.log('Acceptance Window:', `${timeRemaining.hours}h ${timeRemaining.minutes}m remaining`);

  const result = await auctionClient.dealerAcceptBid(wallet, chainInfo, auctionId);

  console.log('\nBid accepted!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 9: Query Auction Details
 */
export async function queryAuctionDetails(auctionId: bigint) {
  console.log('\n=== Auction Details ===\n');
  console.log('Auction ID:', auctionId.toString());

  const { core, items } = await auctionClient.getAuction(chainInfo, auctionId, publicClient);

  console.log('\nCore Info:');
  console.log('  Type:', formatAuctionType(core.auctionType));
  console.log('  Status:', formatAuctionStatus(core.status));
  console.log('  Dealer:', core.dealer);
  console.log('  Payment Token:', core.paymentToken);
  console.log('  Current Bid:', formatAmount(core.currentBid, 18), 'tokens');
  console.log('  High Bidder:', core.highBidder);

  const timeRemaining = calculateTimeRemaining(core.deadline);
  if (!timeRemaining.expired) {
    console.log(
      '  Time Remaining:',
      `${timeRemaining.days}d ${timeRemaining.hours}h ${timeRemaining.minutes}m`
    );
  } else {
    console.log('  Deadline: Expired');
  }

  console.log('\nItems:');
  items.forEach((item: AuctionItem, index: number) => {
    console.log(`  Item ${index + 1}:`);
    console.log(`    Token: ${item.tokenAddress}`);
    console.log(`    Type: ${item.itemType === ItemType.ERC721 ? 'NFT' : 'Token'}`);
    if (item.itemType === ItemType.ERC721) {
      console.log(`    Token ID: ${item.tokenId}`);
    } else {
      console.log(`    Amount: ${formatAmount(item.amount, 18)}`);
    }
  });
}

// Main execution
async function main() {
  console.log('=== EVM Auction Examples ===');
  console.log('Contract:', CONTRACT_ADDRESS);
  console.log('Account:', account.address);

  // Uncomment the examples you want to run:

  // const auctionId = await createTraditionalAuctionExample();
  // const auctionId = await createDutchAuctionExample();
  // const auctionId = await createPennyAuctionExample();

  // await bidOnTraditionalAuction(1n);
  // await buyFromDutchAuction(2n);
  // await bidOnPennyAuction(3n);

  // await finalizeAuction(1n);
  // await dealerAcceptBid(1n);

  // await queryAuctionDetails(1n);
}

main().catch(console.error);
