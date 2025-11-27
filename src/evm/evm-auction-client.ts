/**
 * EVM Auction Client
 * Stateless client for interacting with the AuctionRegistry contract on EVM chains
 */

import {
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
  type Chain,
  getAddress,
} from 'viem';

import {
  AuctionType,
  AuctionStatus,
  ItemType,
  type AuctionItem,
  type AuctionCore,
  type TraditionalParams,
  type DutchParams,
  type PennyParams,
  type CreateTraditionalAuctionParams,
  type CreateDutchAuctionParams,
  type CreatePennyAuctionParams,
  type TransactionResult,
  type ChainInfo,
} from '../types/common.js';

// ABI for AuctionRegistry contract (minimal for client operations)
export const AUCTION_REGISTRY_ABI = [
  // Read functions
  {
    name: 'getAuction',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [
      {
        name: 'core',
        type: 'tuple',
        components: [
          { name: 'dealer', type: 'address' },
          { name: 'auctionType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'paymentToken', type: 'address' },
          { name: 'deadline', type: 'uint96' },
          { name: 'highBidder', type: 'address' },
          { name: 'currentBid', type: 'uint128' },
          { name: 'createdAt', type: 'uint64' },
        ],
      },
      {
        name: 'items',
        type: 'tuple[]',
        components: [
          { name: 'tokenAddress', type: 'address' },
          { name: 'itemType', type: 'uint8' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getTraditionalParams',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'startAmount', type: 'uint128' },
          { name: 'increment', type: 'uint128' },
          { name: 'reservePrice', type: 'uint128' },
          { name: 'acceptanceDeadline', type: 'uint96' },
          { name: 'reserveMet', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getDutchParams',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'startPrice', type: 'uint128' },
          { name: 'decreaseAmount', type: 'uint128' },
          { name: 'decreaseInterval', type: 'uint64' },
          { name: 'minimumPrice', type: 'uint128' },
          { name: 'startTime', type: 'uint64' },
        ],
      },
    ],
  },
  {
    name: 'getPennyParams',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'incrementAmount', type: 'uint128' },
          { name: 'totalPaid', type: 'uint128' },
          { name: 'lastBidTime', type: 'uint64' },
          { name: 'timerDuration', type: 'uint64' },
        ],
      },
    ],
  },
  {
    name: 'getDutchCurrentPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [{ name: 'currentPrice', type: 'uint128' }],
  },
  {
    name: 'getPennyDeadline',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [{ name: 'effectiveDeadline', type: 'uint256' }],
  },
  {
    name: 'nextAuctionId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'paused',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'feeRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    name: 'accumulatedFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Write functions
  {
    name: 'createTraditionalAuction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'items',
        type: 'tuple[]',
        components: [
          { name: 'tokenAddress', type: 'address' },
          { name: 'itemType', type: 'uint8' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'paymentToken', type: 'address' },
      { name: 'startAmount', type: 'uint128' },
      { name: 'increment', type: 'uint128' },
      { name: 'reservePrice', type: 'uint128' },
      { name: 'deadline', type: 'uint96' },
    ],
    outputs: [{ name: 'auctionId', type: 'uint256' }],
  },
  {
    name: 'createDutchAuction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'items',
        type: 'tuple[]',
        components: [
          { name: 'tokenAddress', type: 'address' },
          { name: 'itemType', type: 'uint8' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'paymentToken', type: 'address' },
      { name: 'startPrice', type: 'uint128' },
      { name: 'decreaseAmount', type: 'uint128' },
      { name: 'decreaseInterval', type: 'uint64' },
      { name: 'minimumPrice', type: 'uint128' },
      { name: 'deadline', type: 'uint96' },
    ],
    outputs: [{ name: 'auctionId', type: 'uint256' }],
  },
  {
    name: 'createPennyAuction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'items',
        type: 'tuple[]',
        components: [
          { name: 'tokenAddress', type: 'address' },
          { name: 'itemType', type: 'uint8' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'paymentToken', type: 'address' },
      { name: 'incrementAmount', type: 'uint128' },
    ],
    outputs: [{ name: 'auctionId', type: 'uint256' }],
  },
  {
    name: 'bidTraditional',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'auctionId', type: 'uint256' },
      { name: 'amount', type: 'uint128' },
    ],
    outputs: [],
  },
  {
    name: 'buyDutch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'bidPenny',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'finalizeAuction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'dealerAcceptBid',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    outputs: [],
  },
] as const;

// ERC-20 ABI for approvals
export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export interface EVMWallet {
  walletClient: WalletClient;
  publicClient: PublicClient;
  chain?: Chain;
}

/**
 * Stateless EVM Auction Client
 */
export class EVMAuctionClient {
  /**
   * Get auction details
   */
  async getAuction(
    publicClient: PublicClient,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<{ core: AuctionCore; items: AuctionItem[] }> {
    const result = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'getAuction',
      args: [auctionId],
    });

    const [rawCore, rawItems] = result as [any, any[]];

    const core: AuctionCore = {
      dealer: rawCore.dealer,
      auctionType: rawCore.auctionType as AuctionType,
      status: rawCore.status as AuctionStatus,
      paymentToken: rawCore.paymentToken,
      deadline: BigInt(rawCore.deadline),
      highBidder: rawCore.highBidder,
      currentBid: BigInt(rawCore.currentBid),
      createdAt: BigInt(rawCore.createdAt),
    };

    const items: AuctionItem[] = rawItems.map((item: any) => ({
      tokenAddress: item.tokenAddress,
      itemType: item.itemType as ItemType,
      tokenId: BigInt(item.tokenId),
      amount: BigInt(item.amount),
    }));

    return { core, items };
  }

  /**
   * Get Traditional auction parameters
   */
  async getTraditionalParams(
    publicClient: PublicClient,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<TraditionalParams> {
    const result = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'getTraditionalParams',
      args: [auctionId],
    });

    const params = result as any;
    return {
      startAmount: BigInt(params.startAmount),
      increment: BigInt(params.increment),
      reservePrice: BigInt(params.reservePrice),
      acceptanceDeadline: BigInt(params.acceptanceDeadline),
      reserveMet: params.reserveMet,
    };
  }

  /**
   * Get Dutch auction parameters
   */
  async getDutchParams(
    publicClient: PublicClient,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<DutchParams> {
    const result = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'getDutchParams',
      args: [auctionId],
    });

    const params = result as any;
    return {
      startPrice: BigInt(params.startPrice),
      decreaseAmount: BigInt(params.decreaseAmount),
      decreaseInterval: BigInt(params.decreaseInterval),
      minimumPrice: BigInt(params.minimumPrice),
      startTime: BigInt(params.startTime),
    };
  }

  /**
   * Get current Dutch auction price
   */
  async getDutchCurrentPrice(
    publicClient: PublicClient,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<bigint> {
    const result = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'getDutchCurrentPrice',
      args: [auctionId],
    });

    return BigInt(result as any);
  }

  /**
   * Get Penny auction parameters
   */
  async getPennyParams(
    publicClient: PublicClient,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<PennyParams> {
    const result = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'getPennyParams',
      args: [auctionId],
    });

    const params = result as any;
    return {
      incrementAmount: BigInt(params.incrementAmount),
      totalPaid: BigInt(params.totalPaid),
      lastBidTime: BigInt(params.lastBidTime),
      timerDuration: BigInt(params.timerDuration),
    };
  }

  /**
   * Get effective deadline for Penny auction
   */
  async getPennyDeadline(
    publicClient: PublicClient,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<bigint> {
    const result = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'getPennyDeadline',
      args: [auctionId],
    });

    return BigInt(result as any);
  }

  /**
   * Create a Traditional auction
   */
  async createTraditionalAuction(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    params: CreateTraditionalAuctionParams
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const items = params.items.map((item) => ({
      tokenAddress: getAddress(item.tokenAddress),
      itemType: item.itemType,
      tokenId: item.tokenId,
      amount: item.amount,
    }));

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'createTraditionalAuction',
      args: [
        items,
        getAddress(params.paymentToken),
        params.startAmount,
        params.increment,
        params.reservePrice,
        params.deadline,
      ],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    // Parse auction ID from logs (simplified - in production you'd parse the event)
    const nextId = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'nextAuctionId',
    });

    return {
      txHash: hash,
      auctionId: (nextId as bigint) - 1n,
    };
  }

  /**
   * Create a Dutch auction
   */
  async createDutchAuction(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    params: CreateDutchAuctionParams
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const items = params.items.map((item) => ({
      tokenAddress: getAddress(item.tokenAddress),
      itemType: item.itemType,
      tokenId: item.tokenId,
      amount: item.amount,
    }));

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'createDutchAuction',
      args: [
        items,
        getAddress(params.paymentToken),
        params.startPrice,
        params.decreaseAmount,
        params.decreaseInterval,
        params.minimumPrice,
        params.deadline,
      ],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    const nextId = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'nextAuctionId',
    });

    return {
      txHash: hash,
      auctionId: (nextId as bigint) - 1n,
    };
  }

  /**
   * Create a Penny auction
   */
  async createPennyAuction(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    params: CreatePennyAuctionParams
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const items = params.items.map((item) => ({
      tokenAddress: getAddress(item.tokenAddress),
      itemType: item.itemType,
      tokenId: item.tokenId,
      amount: item.amount,
    }));

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'createPennyAuction',
      args: [items, getAddress(params.paymentToken), params.incrementAmount],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    const nextId = await publicClient.readContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'nextAuctionId',
    });

    return {
      txHash: hash,
      auctionId: (nextId as bigint) - 1n,
    };
  }

  /**
   * Place a bid on a Traditional auction
   */
  async bidTraditional(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    auctionId: bigint,
    amount: bigint
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'bidTraditional',
      args: [auctionId, amount],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { txHash: hash };
  }

  /**
   * Buy at current price in a Dutch auction
   */
  async buyDutch(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'buyDutch',
      args: [auctionId],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { txHash: hash };
  }

  /**
   * Place a bid on a Penny auction
   */
  async bidPenny(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'bidPenny',
      args: [auctionId],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { txHash: hash };
  }

  /**
   * Finalize an auction
   */
  async finalizeAuction(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'finalizeAuction',
      args: [auctionId],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { txHash: hash };
  }

  /**
   * Dealer accepts bid below reserve
   */
  async dealerAcceptBid(
    wallet: EVMWallet,
    chainInfo: ChainInfo,
    auctionId: bigint
  ): Promise<TransactionResult> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const hash = await walletClient.writeContract({
      address: chainInfo.contractAddress as Address,
      abi: AUCTION_REGISTRY_ABI,
      functionName: 'dealerAcceptBid',
      args: [auctionId],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { txHash: hash };
  }

  /**
   * Approve ERC-20 token spending
   */
  async approveToken(
    wallet: EVMWallet,
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint
  ): Promise<Hash> {
    const { walletClient, publicClient, chain } = wallet;
    const account = walletClient.account;

    const hash = await walletClient.writeContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [getAddress(spenderAddress), amount],
      chain: chain ?? walletClient.chain,
      account: account!,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return hash;
  }

  /**
   * Check ERC-20 token allowance
   */
  async checkAllowance(
    publicClient: PublicClient,
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string
  ): Promise<bigint> {
    const result = await publicClient.readContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [getAddress(ownerAddress), getAddress(spenderAddress)],
    });

    return BigInt(result as any);
  }
}
