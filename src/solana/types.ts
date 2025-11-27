/**
 * Solana-specific types for the auction program
 */

import type { PublicKey } from '@solana/web3.js';

export interface SolanaWallet {
  publicKey: PublicKey;
  signTransaction: (tx: any) => Promise<any>;
  signAllTransactions: (txs: any[]) => Promise<any[]>;
}

export interface SolanaChainInfo {
  rpcUrl: string;
  programId: string;
}

export interface SolanaAuctionItem {
  mint: PublicKey;
  isNft: boolean;
  amount: bigint;
}

// Placeholder for Solana auction client implementation
// This would be implemented when the Solana program is built
