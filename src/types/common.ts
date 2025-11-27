/**
 * Common types shared across EVM and Solana clients
 */

// ============ Enums ============

export enum AuctionType {
  Traditional = 0,
  Dutch = 1,
  Penny = 2,
}

export enum AuctionStatus {
  Active = 0,
  Expired = 1,
  Finalized = 2,
  Refunded = 3,
}

export enum ItemType {
  ERC20 = 0,
  ERC721 = 1,
  ERC1155 = 2,
}

// ============ Interfaces ============

export interface AuctionItem {
  tokenAddress: string;
  itemType: ItemType;
  tokenId: bigint;
  amount: bigint;
}

export interface AuctionCore {
  dealer: string;
  auctionType: AuctionType;
  status: AuctionStatus;
  paymentToken: string;
  deadline: bigint;
  highBidder: string;
  currentBid: bigint;
  createdAt: bigint;
}

export interface TraditionalParams {
  startAmount: bigint;
  increment: bigint;
  reservePrice: bigint;
  acceptanceDeadline: bigint;
  reserveMet: boolean;
}

export interface DutchParams {
  startPrice: bigint;
  decreaseAmount: bigint;
  decreaseInterval: bigint;
  minimumPrice: bigint;
  startTime: bigint;
}

export interface PennyParams {
  incrementAmount: bigint;
  totalPaid: bigint;
  lastBidTime: bigint;
  timerDuration: bigint;
}

export interface Auction {
  id: bigint;
  core: AuctionCore;
  items: AuctionItem[];
  params: TraditionalParams | DutchParams | PennyParams;
}

// ============ Creation Parameters ============

export interface CreateTraditionalAuctionParams {
  items: AuctionItem[];
  paymentToken: string;
  startAmount: bigint;
  increment: bigint;
  reservePrice: bigint;
  deadline: bigint;
}

export interface CreateDutchAuctionParams {
  items: AuctionItem[];
  paymentToken: string;
  startPrice: bigint;
  decreaseAmount: bigint;
  decreaseInterval: bigint;
  minimumPrice: bigint;
  deadline: bigint;
}

export interface CreatePennyAuctionParams {
  items: AuctionItem[];
  paymentToken: string;
  incrementAmount: bigint;
}

// ============ Transaction Results ============

export interface TransactionResult {
  txHash: string;
  auctionId?: bigint;
}

// ============ Chain Info ============

export enum ChainType {
  EVM = 'evm',
  Solana = 'solana',
}

export interface ChainInfo {
  chainType: ChainType;
  chainId?: number;
  rpcUrl: string;
  contractAddress: string;
}

// ============ Constants ============

export const PROTOCOL_CONSTANTS = {
  FEE_RATE: 50n, // 0.5% in basis points
  FEE_DENOMINATOR: 10000n,
  ACCEPTANCE_PERIOD: 24n * 60n * 60n, // 24 hours in seconds
  PENNY_TIMER_DURATION: 5n * 60n, // 5 minutes in seconds
  MAX_FEE_RATE: 1000n, // 10% max
};

// ============ Utility Functions ============

export function calculateFee(amount: bigint, feeRate: bigint = PROTOCOL_CONSTANTS.FEE_RATE): {
  fee: bigint;
  netAmount: bigint;
} {
  const fee = (amount * feeRate) / PROTOCOL_CONSTANTS.FEE_DENOMINATOR;
  const netAmount = amount - fee;
  return { fee, netAmount };
}

export function formatAuctionType(type: AuctionType): string {
  switch (type) {
    case AuctionType.Traditional:
      return 'Traditional';
    case AuctionType.Dutch:
      return 'Dutch';
    case AuctionType.Penny:
      return 'Penny';
    default:
      return 'Unknown';
  }
}

export function formatAuctionStatus(status: AuctionStatus): string {
  switch (status) {
    case AuctionStatus.Active:
      return 'Active';
    case AuctionStatus.Expired:
      return 'Expired';
    case AuctionStatus.Finalized:
      return 'Finalized';
    case AuctionStatus.Refunded:
      return 'Refunded';
    default:
      return 'Unknown';
  }
}

export function formatItemType(type: ItemType): string {
  switch (type) {
    case ItemType.ERC20:
      return 'ERC-20';
    case ItemType.ERC721:
      return 'ERC-721';
    case ItemType.ERC1155:
      return 'ERC-1155';
    default:
      return 'Unknown';
  }
}
