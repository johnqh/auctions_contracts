/**
 * Solana Auction Usage Examples
 *
 * This file demonstrates how to use the auction program on Solana.
 * Before running, ensure you have:
 * 1. Deployed and initialized the program (see scripts/solana/deploy.ts)
 * 2. A funded wallet keypair
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

import { SolanaAuctionClient } from '../src/solana/solana-auction-client.js';
import type { SolanaChainInfo, SolanaWallet } from '../src/solana/types.js';
import { AuctionStatus, formatAmount, formatAuctionStatus } from '../src/types/common.js';

// Configuration (update these values)
const PROGRAM_ID = process.env.SOLANA_PROGRAM_ID || 'AucT1onProgramXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH ||
  path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');
const NETWORK = (process.env.SOLANA_NETWORK as 'devnet' | 'mainnet-beta') || 'devnet';

// SPL Token addresses (update for your tokens)
const PAYMENT_MINT = new PublicKey(process.env.PAYMENT_MINT || 'So11111111111111111111111111111111111111112'); // Wrapped SOL
const NFT_MINT = new PublicKey(process.env.NFT_MINT || '11111111111111111111111111111111'); // Your NFT mint

// Load keypair
function loadKeypair(keypairPath: string): Keypair {
  const resolvedPath = keypairPath.replace('~', process.env.HOME || '');
  const keypairData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

// Setup
const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');
const keypair = loadKeypair(KEYPAIR_PATH);

// Create a simple wallet adapter
const wallet: SolanaWallet = {
  publicKey: keypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(keypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    txs.forEach(tx => tx.partialSign(keypair));
    return txs;
  },
};

// Chain info
const chainInfo: SolanaChainInfo = {
  programId: PROGRAM_ID,
  cluster: NETWORK,
};

// Create client
const auctionClient = new SolanaAuctionClient();

/**
 * Helper: Format auction ID for display
 */
function formatAuctionId(id: Uint8Array): string {
  return Buffer.from(id).toString('hex').slice(0, 16) + '...';
}

/**
 * Example 1: Create a Traditional Auction
 */
export async function createTraditionalAuctionExample() {
  console.log('\n=== Creating Traditional Auction ===\n');

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 7 days

  const params = {
    paymentMint: PAYMENT_MINT,
    startAmount: 1_000_000_000n, // 1 SOL in lamports
    increment: 100_000_000n, // 0.1 SOL
    reservePrice: 10_000_000_000n, // 10 SOL
    deadline,
  };

  console.log('Parameters:');
  console.log('  Payment Mint:', PAYMENT_MINT.toBase58());
  console.log('  Start Amount:', formatAmount(params.startAmount, 9), 'SOL');
  console.log('  Increment:', formatAmount(params.increment, 9), 'SOL');
  console.log('  Reserve Price:', formatAmount(params.reservePrice, 9), 'SOL');

  const result = await auctionClient.createTraditionalAuction(
    wallet,
    connection,
    chainInfo,
    params
  );

  console.log('\nAuction created!');
  console.log('  Transaction:', result.txHash);
  console.log('  Auction ID:', formatAuctionId(result.solanaAuctionId));

  // Save auction ID for later use
  fs.writeFileSync(
    'auction-id.json',
    JSON.stringify({
      auctionId: Array.from(result.solanaAuctionId),
      type: 'traditional',
    })
  );

  return result.solanaAuctionId;
}

/**
 * Example 2: Create a Dutch Auction
 */
export async function createDutchAuctionExample() {
  console.log('\n=== Creating Dutch Auction ===\n');

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60); // 24 hours

  const params = {
    paymentMint: PAYMENT_MINT,
    startPrice: 100_000_000_000n, // 100 SOL
    decreaseAmount: 1_000_000_000n, // 1 SOL decrease
    interval: 3600n, // Every hour
    minimumPrice: 10_000_000_000n, // Floor at 10 SOL
    deadline,
  };

  console.log('Parameters:');
  console.log('  Start Price:', formatAmount(params.startPrice, 9), 'SOL');
  console.log('  Decrease:', formatAmount(params.decreaseAmount, 9), 'SOL per hour');
  console.log('  Minimum Price:', formatAmount(params.minimumPrice, 9), 'SOL');

  const result = await auctionClient.createDutchAuction(
    wallet,
    connection,
    chainInfo,
    params
  );

  console.log('\nDutch auction created!');
  console.log('  Transaction:', result.txHash);
  console.log('  Auction ID:', formatAuctionId(result.solanaAuctionId));

  return result.solanaAuctionId;
}

/**
 * Example 3: Create a Penny Auction
 */
export async function createPennyAuctionExample() {
  console.log('\n=== Creating Penny Auction ===\n');

  const params = {
    paymentMint: PAYMENT_MINT,
    increment: 10_000_000n, // 0.01 SOL per bid
    timerDuration: 300n, // 5 minutes
  };

  console.log('Parameters:');
  console.log('  Bid Cost:', formatAmount(params.increment, 9), 'SOL');
  console.log('  Timer Duration:', params.timerDuration.toString(), 'seconds');

  const result = await auctionClient.createPennyAuction(
    wallet,
    connection,
    chainInfo,
    params
  );

  console.log('\nPenny auction created!');
  console.log('  Transaction:', result.txHash);
  console.log('  Auction ID:', formatAuctionId(result.solanaAuctionId));

  return result.solanaAuctionId;
}

/**
 * Example 4: Deposit Tokens into Auction
 */
export async function depositTokensExample(auctionId: Uint8Array) {
  console.log('\n=== Depositing Tokens ===\n');
  console.log('Auction ID:', formatAuctionId(auctionId));

  const amount = 1_000_000_000n; // 1 token (adjust decimals for your token)

  console.log('Depositing:', formatAmount(amount, 9), 'tokens');
  console.log('Mint:', NFT_MINT.toBase58());

  const result = await auctionClient.depositTokens(
    wallet,
    connection,
    chainInfo,
    auctionId,
    NFT_MINT,
    amount,
    0 // Item index
  );

  console.log('\nTokens deposited!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 5: Place a Bid on Traditional Auction
 */
export async function bidOnTraditionalAuction(auctionId: Uint8Array) {
  console.log('\n=== Placing Bid ===\n');
  console.log('Auction ID:', formatAuctionId(auctionId));

  // Get current auction state
  const { core } = await auctionClient.getAuction(connection, chainInfo, auctionId);

  console.log('Current State:');
  console.log('  Status:', formatAuctionStatus(core.status));
  console.log('  Current Bid:', formatAmount(core.currentBid, 9), 'SOL');
  console.log('  High Bidder:', core.highBidder);

  if (core.status !== AuctionStatus.Active) {
    console.log('Auction is not active');
    return;
  }

  // Bid amount (should be current + increment)
  const bidAmount = core.currentBid + 500_000_000n; // Current + 0.5 SOL

  console.log('\nPlacing bid:', formatAmount(bidAmount, 9), 'SOL');

  // Get previous bidder's token account for refund (if any)
  let previousBidderToken: PublicKey | undefined;
  if (core.highBidder !== '11111111111111111111111111111111') {
    previousBidderToken = await getAssociatedTokenAddress(
      new PublicKey(core.paymentToken),
      new PublicKey(core.highBidder)
    );
  }

  const result = await auctionClient.bidTraditional(
    wallet,
    connection,
    chainInfo,
    auctionId,
    bidAmount,
    previousBidderToken
  );

  console.log('Bid placed!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 6: Buy from Dutch Auction
 */
export async function buyFromDutchAuction(auctionId: Uint8Array) {
  console.log('\n=== Buying from Dutch Auction ===\n');
  console.log('Auction ID:', formatAuctionId(auctionId));

  const { core } = await auctionClient.getAuction(connection, chainInfo, auctionId);

  console.log('Status:', formatAuctionStatus(core.status));

  if (core.status !== AuctionStatus.Active) {
    console.log('Auction is not active');
    return;
  }

  // Get dealer's token account for payment
  const dealerTokenAccount = await getAssociatedTokenAddress(
    new PublicKey(core.paymentToken),
    new PublicKey(core.dealer)
  );

  // Set max price (current price + buffer for price changes)
  const maxPrice = 50_000_000_000n; // 50 SOL max

  console.log('Max Price:', formatAmount(maxPrice, 9), 'SOL');

  const result = await auctionClient.buyDutch(
    wallet,
    connection,
    chainInfo,
    auctionId,
    maxPrice,
    dealerTokenAccount
  );

  console.log('\nPurchase complete!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 7: Place Bid on Penny Auction
 */
export async function bidOnPennyAuction(auctionId: Uint8Array) {
  console.log('\n=== Bidding on Penny Auction ===\n');
  console.log('Auction ID:', formatAuctionId(auctionId));

  const { core } = await auctionClient.getAuction(connection, chainInfo, auctionId);

  console.log('Status:', formatAuctionStatus(core.status));
  console.log('Current Leader:', core.highBidder);

  if (core.status !== AuctionStatus.Active) {
    console.log('Auction is not active');
    return;
  }

  // Get dealer's token account for the bid payment
  const dealerTokenAccount = await getAssociatedTokenAddress(
    new PublicKey(core.paymentToken),
    new PublicKey(core.dealer)
  );

  const result = await auctionClient.bidPenny(
    wallet,
    connection,
    chainInfo,
    auctionId,
    dealerTokenAccount
  );

  console.log('\nBid placed! Timer reset.');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 8: Finalize Auction
 */
export async function finalizeAuction(auctionId: Uint8Array) {
  console.log('\n=== Finalizing Auction ===\n');
  console.log('Auction ID:', formatAuctionId(auctionId));

  const { core } = await auctionClient.getAuction(connection, chainInfo, auctionId);

  console.log('Status:', formatAuctionStatus(core.status));
  console.log('Winner:', core.highBidder);
  console.log('Final Price:', formatAmount(core.currentBid, 9), 'SOL');

  // Get token accounts
  const paymentMint = new PublicKey(core.paymentToken);
  const dealerTokenAccount = await getAssociatedTokenAddress(
    paymentMint,
    new PublicKey(core.dealer)
  );
  const winnerTokenAccount = await getAssociatedTokenAddress(
    paymentMint,
    new PublicKey(core.highBidder)
  );

  const result = await auctionClient.finalizeAuction(
    wallet,
    connection,
    chainInfo,
    auctionId,
    dealerTokenAccount,
    winnerTokenAccount
  );

  console.log('\nAuction finalized!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 9: Dealer Accepts Bid Below Reserve
 */
export async function dealerAcceptBid(auctionId: Uint8Array) {
  console.log('\n=== Dealer Accepting Bid ===\n');
  console.log('Auction ID:', formatAuctionId(auctionId));

  const { core } = await auctionClient.getAuction(connection, chainInfo, auctionId);

  console.log('Current Bid:', formatAmount(core.currentBid, 9), 'SOL');

  // Get dealer's token account
  const dealerTokenAccount = await getAssociatedTokenAddress(
    new PublicKey(core.paymentToken),
    new PublicKey(core.dealer)
  );

  const result = await auctionClient.acceptBid(
    wallet,
    connection,
    chainInfo,
    auctionId,
    dealerTokenAccount
  );

  console.log('\nBid accepted!');
  console.log('  Transaction:', result.txHash);
}

/**
 * Example 10: Query Auction Details
 */
export async function queryAuctionDetails(auctionId: Uint8Array) {
  console.log('\n=== Auction Details ===\n');
  console.log('Auction ID:', formatAuctionId(auctionId));

  const { core, items } = await auctionClient.getAuction(connection, chainInfo, auctionId);

  console.log('\nCore Info:');
  console.log('  Status:', formatAuctionStatus(core.status));
  console.log('  Dealer:', core.dealer);
  console.log('  Payment Token:', core.paymentToken);
  console.log('  Current Bid:', formatAmount(core.currentBid, 9), 'SOL');
  console.log('  High Bidder:', core.highBidder);

  console.log('\nItems:');
  items.forEach((item, index) => {
    console.log(`  Item ${index + 1}:`);
    console.log(`    Mint: ${item.tokenAddress}`);
    console.log(`    Amount: ${formatAmount(item.amount, 9)}`);
  });

  // Derive PDAs for reference
  const programId = new PublicKey(chainInfo.programId);
  const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
  const [escrowPDA] = SolanaAuctionClient.deriveEscrowPDA(programId, auctionId);

  console.log('\nPDAs:');
  console.log('  Auction:', auctionPDA.toBase58());
  console.log('  Escrow:', escrowPDA.toBase58());
}

/**
 * Load saved auction ID from file
 */
export function loadSavedAuctionId(): Uint8Array | null {
  try {
    if (fs.existsSync('auction-id.json')) {
      const data = JSON.parse(fs.readFileSync('auction-id.json', 'utf-8'));
      return new Uint8Array(data.auctionId);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Main execution
async function main() {
  console.log('=== Solana Auction Examples ===');
  console.log('Network:', NETWORK);
  console.log('Program ID:', PROGRAM_ID);
  console.log('Wallet:', keypair.publicKey.toBase58());

  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL');

  if (balance < 0.1 * 1e9) {
    console.log('\nWarning: Low balance. Request airdrop for devnet:');
    console.log('  solana airdrop 2 --url devnet');
  }

  // Uncomment the examples you want to run:

  // const auctionId = await createTraditionalAuctionExample();
  // const auctionId = await createDutchAuctionExample();
  // const auctionId = await createPennyAuctionExample();

  // const savedId = loadSavedAuctionId();
  // if (savedId) {
  //   await depositTokensExample(savedId);
  //   await bidOnTraditionalAuction(savedId);
  //   await queryAuctionDetails(savedId);
  // }

  // await buyFromDutchAuction(auctionId);
  // await bidOnPennyAuction(auctionId);
  // await finalizeAuction(auctionId);
  // await dealerAcceptBid(auctionId);
}

main().catch(console.error);
