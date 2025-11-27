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

// ============ Validation Utilities ============

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate Traditional auction parameters
 */
export function validateTraditionalParams(params: {
  startAmount: bigint;
  increment: bigint;
  reservePrice: bigint;
  deadline: bigint;
}): ValidationResult {
  const errors: string[] = [];
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (params.startAmount <= 0n) {
    errors.push('Start amount must be greater than 0');
  }

  if (params.increment <= 0n) {
    errors.push('Increment must be greater than 0');
  }

  if (params.reservePrice < params.startAmount) {
    errors.push('Reserve price must be >= start amount');
  }

  if (params.deadline <= now) {
    errors.push('Deadline must be in the future');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Dutch auction parameters
 */
export function validateDutchParams(params: {
  startPrice: bigint;
  decreaseAmount: bigint;
  decreaseInterval: bigint;
  minimumPrice: bigint;
  deadline: bigint;
}): ValidationResult {
  const errors: string[] = [];
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (params.startPrice <= 0n) {
    errors.push('Start price must be greater than 0');
  }

  if (params.decreaseAmount <= 0n) {
    errors.push('Decrease amount must be greater than 0');
  }

  if (params.decreaseInterval <= 0n) {
    errors.push('Decrease interval must be greater than 0');
  }

  if (params.minimumPrice >= params.startPrice) {
    errors.push('Minimum price must be less than start price');
  }

  if (params.deadline <= now) {
    errors.push('Deadline must be in the future');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Penny auction parameters
 */
export function validatePennyParams(params: {
  incrementAmount: bigint;
  timerDuration?: bigint;
}): ValidationResult {
  const errors: string[] = [];

  if (params.incrementAmount <= 0n) {
    errors.push('Increment amount must be greater than 0');
  }

  if (params.timerDuration !== undefined && params.timerDuration <= 0n) {
    errors.push('Timer duration must be greater than 0');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate bid amount for Traditional auction
 */
export function validateTraditionalBid(
  currentBid: bigint,
  newBid: bigint,
  params: TraditionalParams
): ValidationResult {
  const errors: string[] = [];

  const minBid = currentBid === 0n ? params.startAmount : currentBid + params.increment;

  if (newBid < minBid) {
    errors.push(`Bid must be at least ${minBid.toString()}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if Traditional auction is active
 */
export function isTraditionalAuctionActive(
  status: AuctionStatus,
  deadline: bigint
): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return status === AuctionStatus.Active && deadline > now;
}

/**
 * Check if Dutch auction is active
 */
export function isDutchAuctionActive(
  status: AuctionStatus,
  deadline: bigint
): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return status === AuctionStatus.Active && deadline > now;
}

/**
 * Check if Penny auction is active
 */
export function isPennyAuctionActive(
  status: AuctionStatus,
  currentDeadline: bigint
): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  // Penny auction is active if no deadline set yet, or deadline not passed
  return status === AuctionStatus.Active && (currentDeadline === 0n || currentDeadline > now);
}

/**
 * Calculate current Dutch auction price
 */
export function calculateDutchPrice(
  params: DutchParams,
  currentTime?: bigint
): bigint {
  const now = currentTime ?? BigInt(Math.floor(Date.now() / 1000));
  const elapsed = now - params.startTime;

  if (elapsed <= 0n) {
    return params.startPrice;
  }

  const intervals = elapsed / params.decreaseInterval;
  const decrease = intervals * params.decreaseAmount;
  const currentPrice = params.startPrice - decrease;

  return currentPrice > params.minimumPrice ? currentPrice : params.minimumPrice;
}

/**
 * Calculate time remaining for auction
 */
export function calculateTimeRemaining(deadline: bigint): {
  total: bigint;
  days: bigint;
  hours: bigint;
  minutes: bigint;
  seconds: bigint;
  expired: boolean;
} {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const remaining = deadline - now;

  if (remaining <= 0n) {
    return { total: 0n, days: 0n, hours: 0n, minutes: 0n, seconds: 0n, expired: true };
  }

  const days = remaining / 86400n;
  const hours = (remaining % 86400n) / 3600n;
  const minutes = (remaining % 3600n) / 60n;
  const seconds = remaining % 60n;

  return { total: remaining, days, hours, minutes, seconds, expired: false };
}

/**
 * Format amount with decimals
 */
export function formatAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;

  if (fractionalPart === 0n) {
    return wholePart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');

  return `${wholePart}.${trimmedFractional}`;
}

/**
 * Parse amount string to bigint
 */
export function parseAmount(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFraction);
}
