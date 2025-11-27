/**
 * Unified Onchain Auction Client
 * Stateless client that detects chain type and routes to appropriate platform client
 */

import type { PublicClient } from 'viem';
import type { Connection } from '@solana/web3.js';

import {
  ChainType,
  type ChainInfo,
  type AuctionCore,
  type AuctionItem,
  type TraditionalParams,
  type DutchParams,
  type PennyParams,
  type CreateTraditionalAuctionParams,
  type CreateDutchAuctionParams,
  type CreatePennyAuctionParams,
  type TransactionResult,
} from '../types/common.js';

import type { EVMWallet } from '../evm/evm-auction-client.js';
import type { SolanaWallet, SolanaChainInfo } from '../solana/types.js';

export type UnifiedWallet = EVMWallet | SolanaWallet;

/**
 * Unified Onchain Auction Client
 * Lazy-loads platform-specific clients to optimize bundle size
 */
export class OnchainAuctionClient {
  private static evmClient: any = null;
  private static solanaClient: any = null;

  /**
   * Lazy-load EVM client
   */
  private async getEVMClient() {
    if (!OnchainAuctionClient.evmClient) {
      const { EVMAuctionClient } = await import('../evm/evm-auction-client.js');
      OnchainAuctionClient.evmClient = new EVMAuctionClient();
    }
    return OnchainAuctionClient.evmClient;
  }

  /**
   * Lazy-load Solana client
   */
  private async getSolanaClient() {
    if (!OnchainAuctionClient.solanaClient) {
      const { SolanaAuctionClient } = await import('../solana/solana-auction-client.js');
      OnchainAuctionClient.solanaClient = new SolanaAuctionClient();
    }
    return OnchainAuctionClient.solanaClient;
  }

  /**
   * Detect wallet type
   */
  private isEVMWallet(wallet: UnifiedWallet): wallet is EVMWallet {
    return 'walletClient' in wallet && 'publicClient' in wallet;
  }

  /**
   * Detect chain type from ChainInfo
   */
  private isEVMChain(chainInfo: ChainInfo | SolanaChainInfo): chainInfo is ChainInfo {
    return 'chainType' in chainInfo && (chainInfo as ChainInfo).chainType === ChainType.EVM;
  }

  // ============ Read Methods ============

  /**
   * Get auction details
   */
  async getAuction(
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array,
    publicClientOrConnection?: PublicClient | Connection
  ): Promise<{ core: AuctionCore; items: AuctionItem[] }> {
    if (this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.getAuction(
        publicClientOrConnection as PublicClient,
        chainInfo,
        auctionId as bigint
      );
    } else {
      const client = await this.getSolanaClient();
      return client.getAuction(
        publicClientOrConnection as Connection,
        chainInfo,
        auctionId as Uint8Array
      );
    }
  }

  /**
   * Get Traditional auction parameters
   */
  async getTraditionalParams(
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array,
    publicClientOrConnection?: PublicClient | Connection
  ): Promise<TraditionalParams> {
    if (this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.getTraditionalParams(
        publicClientOrConnection as PublicClient,
        chainInfo,
        auctionId as bigint
      );
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Get Dutch auction parameters
   */
  async getDutchParams(
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array,
    publicClientOrConnection?: PublicClient | Connection
  ): Promise<DutchParams> {
    if (this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.getDutchParams(
        publicClientOrConnection as PublicClient,
        chainInfo,
        auctionId as bigint
      );
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Get current Dutch auction price
   */
  async getDutchCurrentPrice(
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array,
    publicClientOrConnection?: PublicClient | Connection
  ): Promise<bigint> {
    if (this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.getDutchCurrentPrice(
        publicClientOrConnection as PublicClient,
        chainInfo,
        auctionId as bigint
      );
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Get Penny auction parameters
   */
  async getPennyParams(
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array,
    publicClientOrConnection?: PublicClient | Connection
  ): Promise<PennyParams> {
    if (this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.getPennyParams(
        publicClientOrConnection as PublicClient,
        chainInfo,
        auctionId as bigint
      );
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  // ============ Write Methods ============

  /**
   * Create a Traditional auction
   */
  async createTraditionalAuction(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    params: CreateTraditionalAuctionParams
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.createTraditionalAuction(wallet, chainInfo, params);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Create a Dutch auction
   */
  async createDutchAuction(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    params: CreateDutchAuctionParams
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.createDutchAuction(wallet, chainInfo, params);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Create a Penny auction
   */
  async createPennyAuction(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    params: CreatePennyAuctionParams
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.createPennyAuction(wallet, chainInfo, params);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Place a bid on a Traditional auction
   */
  async bidTraditional(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array,
    amount: bigint
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.bidTraditional(wallet, chainInfo, auctionId as bigint, amount);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Buy at current price in a Dutch auction
   */
  async buyDutch(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.buyDutch(wallet, chainInfo, auctionId as bigint);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Place a bid on a Penny auction
   */
  async bidPenny(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.bidPenny(wallet, chainInfo, auctionId as bigint);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Finalize an auction
   */
  async finalizeAuction(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.finalizeAuction(wallet, chainInfo, auctionId as bigint);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }

  /**
   * Dealer accepts bid below reserve (Traditional only)
   */
  async dealerAcceptBid(
    wallet: UnifiedWallet,
    chainInfo: ChainInfo | SolanaChainInfo,
    auctionId: bigint | Uint8Array
  ): Promise<TransactionResult> {
    if (this.isEVMWallet(wallet) && this.isEVMChain(chainInfo)) {
      const client = await this.getEVMClient();
      return client.dealerAcceptBid(wallet, chainInfo, auctionId as bigint);
    } else {
      throw new Error('Solana not yet implemented');
    }
  }
}
