/**
 * Solana Auction Client
 * Stateless client for interacting with the auction program on Solana
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import type { SolanaWallet, SolanaChainInfo } from './types.js';
import {
  AuctionType,
  AuctionStatus,
  type AuctionCore,
  type AuctionItem,
  type TraditionalParams,
  type DutchParams,
  type PennyParams,
  type TransactionResult,
  ItemType,
} from '../types/common.js';

// PDA version constant (must match Rust program)
const PDA_VERSION = 1;

// Seeds for PDAs
const PROGRAM_STATE_SEED = Buffer.from('auction_state');
const AUCTION_SEED = Buffer.from('auction');
const ESCROW_SEED = Buffer.from('escrow');
const ITEM_SEED = Buffer.from('item');
const ITEM_VAULT_SEED = Buffer.from('item_vault');
const FEE_VAULT_SEED = Buffer.from('fee_vault');

// Instruction discriminators
enum InstructionType {
  Initialize = 0,
  SetPaused = 1,
  TransferOwnership = 2,
  ClaimFees = 3,
  CreateTraditionalAuction = 4,
  CreateDutchAuction = 5,
  CreatePennyAuction = 6,
  DepositTokens = 7,
  DepositNft = 8,
  BidTraditional = 9,
  BuyDutch = 10,
  BidPenny = 11,
  FinalizeAuction = 12,
  AcceptBid = 13,
  CloseItemVault = 14,
}

/**
 * Solana Auction Client
 */
export class SolanaAuctionClient {
  /**
   * Derive PDA for program state
   */
  static deriveProgramStatePDA(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([PROGRAM_STATE_SEED], programId);
  }

  /**
   * Derive PDA for auction account
   */
  static deriveAuctionPDA(
    programId: PublicKey,
    auctionId: Uint8Array
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [AUCTION_SEED, Buffer.from([PDA_VERSION]), Buffer.from(auctionId)],
      programId
    );
  }

  /**
   * Derive PDA for escrow account
   */
  static deriveEscrowPDA(
    programId: PublicKey,
    auctionId: Uint8Array
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ESCROW_SEED, Buffer.from([PDA_VERSION]), Buffer.from(auctionId)],
      programId
    );
  }

  /**
   * Derive PDA for item account
   */
  static deriveItemPDA(
    programId: PublicKey,
    auctionId: Uint8Array,
    itemIndex: number
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        ITEM_SEED,
        Buffer.from([PDA_VERSION]),
        Buffer.from(auctionId),
        Buffer.from([itemIndex]),
      ],
      programId
    );
  }

  /**
   * Derive PDA for item vault
   */
  static deriveItemVaultPDA(
    programId: PublicKey,
    auctionId: Uint8Array,
    mint: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        ITEM_VAULT_SEED,
        Buffer.from([PDA_VERSION]),
        Buffer.from(auctionId),
        mint.toBuffer(),
      ],
      programId
    );
  }

  /**
   * Derive PDA for fee vault
   */
  static deriveFeeVaultPDA(
    programId: PublicKey,
    paymentMint: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [FEE_VAULT_SEED, Buffer.from([PDA_VERSION]), paymentMint.toBuffer()],
      programId
    );
  }

  /**
   * Generate a random auction ID
   */
  static generateAuctionId(): Uint8Array {
    const id = new Uint8Array(32);
    crypto.getRandomValues(id);
    return id;
  }

  /**
   * Parse auction data from account
   */
  private parseAuction(data: Buffer): {
    core: AuctionCore;
    auctionType: AuctionType;
    params: TraditionalParams | DutchParams | PennyParams;
    itemCount: number;
  } {
    let offset = 0;

    // auction_id: [u8; 32]
    offset += 32;

    // version: u8
    offset += 1;

    // bump: u8
    offset += 1;

    // escrow_bump: u8
    offset += 1;

    // status: u8
    const status = data.readUInt8(offset) as AuctionStatus;
    offset += 1;

    // auction_type_tag: u8
    const auctionTypeTag = data.readUInt8(offset) as AuctionType;
    offset += 1;

    // dealer: Pubkey (32 bytes)
    const dealer = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;

    // current_bidder: Pubkey (32 bytes)
    const highBidder = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;

    // payment_mint: Pubkey (32 bytes)
    const paymentToken = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;

    // current_bid: u64
    const currentBid = data.readBigUInt64LE(offset);
    offset += 8;

    // Parse auction_type enum (variable size based on type)
    // This is simplified - actual parsing depends on Borsh serialization
    let params: TraditionalParams | DutchParams | PennyParams;
    const typeDiscriminator = data.readUInt8(offset);
    offset += 1;

    if (typeDiscriminator === 0) {
      // Traditional
      params = {
        startAmount: data.readBigUInt64LE(offset),
        increment: data.readBigUInt64LE(offset + 8),
        reservePrice: data.readBigUInt64LE(offset + 16),
        acceptanceDeadline: data.readBigInt64LE(offset + 24),
        reserveMet: data.readUInt8(offset + 32) === 1,
      };
      offset += 41;
    } else if (typeDiscriminator === 1) {
      // Dutch
      params = {
        startPrice: data.readBigUInt64LE(offset),
        decreaseAmount: data.readBigUInt64LE(offset + 8),
        decreaseInterval: data.readBigInt64LE(offset + 16),
        minimumPrice: data.readBigUInt64LE(offset + 24),
        startTime: data.readBigInt64LE(offset + 32),
      };
      offset += 40;
    } else {
      // Penny
      params = {
        incrementAmount: data.readBigUInt64LE(offset),
        timerDuration: data.readBigInt64LE(offset + 8),
        lastBidTime: data.readBigInt64LE(offset + 24),
        totalPaid: data.readBigUInt64LE(offset + 16),
      };
      offset += 40;
    }

    // item_count: u8
    const itemCount = data.readUInt8(offset);
    offset += 1;

    // created_at: i64
    const createdAt = data.readBigInt64LE(offset);
    offset += 8;

    // finalized_at: i64 (skip)
    offset += 8;

    // Get deadline from params
    let deadline: bigint;
    if ('deadline' in (params as any)) {
      deadline = BigInt((params as any).deadline);
    } else if ('currentDeadline' in (params as any)) {
      deadline = BigInt((params as any).currentDeadline);
    } else {
      deadline = 0n;
    }

    const core: AuctionCore = {
      dealer,
      auctionType: auctionTypeTag,
      status,
      paymentToken,
      deadline,
      highBidder,
      currentBid,
      createdAt,
    };

    return { core, auctionType: auctionTypeTag, params, itemCount };
  }

  /**
   * Get auction details
   */
  async getAuction(
    connection: Connection,
    chainInfo: SolanaChainInfo,
    auctionId: Uint8Array
  ): Promise<{ core: AuctionCore; items: AuctionItem[] }> {
    const programId = new PublicKey(chainInfo.programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);

    const accountInfo = await connection.getAccountInfo(auctionPDA);
    if (!accountInfo) {
      throw new Error('Auction not found');
    }

    const { core, itemCount } = this.parseAuction(accountInfo.data);

    // Fetch items
    const items: AuctionItem[] = [];
    for (let i = 0; i < itemCount; i++) {
      const [itemPDA] = SolanaAuctionClient.deriveItemPDA(programId, auctionId, i);
      const itemInfo = await connection.getAccountInfo(itemPDA);
      if (itemInfo) {
        // Parse item data
        const data = itemInfo.data;
        let offset = 32; // skip auction_id
        const mint = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
        const amount = data.readBigUInt64LE(offset);
        offset += 8;
        const isNft = data.readUInt8(offset) === 1;

        items.push({
          tokenAddress: mint,
          itemType: isNft ? ItemType.ERC721 : ItemType.ERC20,
          tokenId: 0n, // NFT token ID not tracked in current implementation
          amount,
        });
      }
    }

    return { core, items };
  }

  /**
   * Build instruction data
   */
  private buildInstructionData(
    type: InstructionType,
    data: Buffer = Buffer.alloc(0)
  ): Buffer {
    // Borsh enum serialization: 4-byte discriminator + data
    const discriminator = Buffer.alloc(1);
    discriminator.writeUInt8(type);
    return Buffer.concat([discriminator, data]);
  }

  /**
   * Create a Traditional auction
   */
  async createTraditionalAuction(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    params: {
      auctionId?: Uint8Array;
      paymentMint: PublicKey;
      startAmount: bigint;
      increment: bigint;
      reservePrice: bigint;
      deadline: bigint;
    }
  ): Promise<TransactionResult & { solanaAuctionId: Uint8Array }> {
    const programId = new PublicKey(chainInfo.programId);
    const auctionId = params.auctionId || SolanaAuctionClient.generateAuctionId();

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
    const [escrowPDA] = SolanaAuctionClient.deriveEscrowPDA(programId, auctionId);

    // Build instruction data
    const dataBuffer = Buffer.alloc(32 + 8 + 8 + 8 + 8);
    let offset = 0;
    Buffer.from(auctionId).copy(dataBuffer, offset);
    offset += 32;
    dataBuffer.writeBigUInt64LE(params.startAmount, offset);
    offset += 8;
    dataBuffer.writeBigUInt64LE(params.increment, offset);
    offset += 8;
    dataBuffer.writeBigUInt64LE(params.reservePrice, offset);
    offset += 8;
    dataBuffer.writeBigInt64LE(params.deadline, offset);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: params.paymentMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(
        InstructionType.CreateTraditionalAuction,
        dataBuffer
      ),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return {
      txHash,
      solanaAuctionId: auctionId,
    };
  }

  /**
   * Create a Dutch auction
   */
  async createDutchAuction(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    params: {
      auctionId?: Uint8Array;
      paymentMint: PublicKey;
      startPrice: bigint;
      decreaseAmount: bigint;
      interval: bigint;
      minimumPrice: bigint;
      deadline: bigint;
    }
  ): Promise<TransactionResult & { solanaAuctionId: Uint8Array }> {
    const programId = new PublicKey(chainInfo.programId);
    const auctionId = params.auctionId || SolanaAuctionClient.generateAuctionId();

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
    const [escrowPDA] = SolanaAuctionClient.deriveEscrowPDA(programId, auctionId);

    // Build instruction data
    const dataBuffer = Buffer.alloc(32 + 8 + 8 + 8 + 8 + 8);
    let offset = 0;
    Buffer.from(auctionId).copy(dataBuffer, offset);
    offset += 32;
    dataBuffer.writeBigUInt64LE(params.startPrice, offset);
    offset += 8;
    dataBuffer.writeBigUInt64LE(params.decreaseAmount, offset);
    offset += 8;
    dataBuffer.writeBigInt64LE(params.interval, offset);
    offset += 8;
    dataBuffer.writeBigUInt64LE(params.minimumPrice, offset);
    offset += 8;
    dataBuffer.writeBigInt64LE(params.deadline, offset);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: params.paymentMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(
        InstructionType.CreateDutchAuction,
        dataBuffer
      ),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return {
      txHash,
      solanaAuctionId: auctionId,
    };
  }

  /**
   * Create a Penny auction
   */
  async createPennyAuction(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    params: {
      auctionId?: Uint8Array;
      paymentMint: PublicKey;
      increment: bigint;
      timerDuration: bigint;
    }
  ): Promise<TransactionResult & { solanaAuctionId: Uint8Array }> {
    const programId = new PublicKey(chainInfo.programId);
    const auctionId = params.auctionId || SolanaAuctionClient.generateAuctionId();

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
    const [escrowPDA] = SolanaAuctionClient.deriveEscrowPDA(programId, auctionId);

    // Build instruction data
    const dataBuffer = Buffer.alloc(32 + 8 + 8);
    let offset = 0;
    Buffer.from(auctionId).copy(dataBuffer, offset);
    offset += 32;
    dataBuffer.writeBigUInt64LE(params.increment, offset);
    offset += 8;
    dataBuffer.writeBigInt64LE(params.timerDuration, offset);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: params.paymentMint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(
        InstructionType.CreatePennyAuction,
        dataBuffer
      ),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return {
      txHash,
      solanaAuctionId: auctionId,
    };
  }

  /**
   * Deposit tokens into auction
   */
  async depositTokens(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    auctionId: Uint8Array,
    mint: PublicKey,
    amount: bigint,
    itemIndex: number
  ): Promise<TransactionResult> {
    const programId = new PublicKey(chainInfo.programId);

    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
    const [itemPDA] = SolanaAuctionClient.deriveItemPDA(programId, auctionId, itemIndex);
    const [itemVaultPDA] = SolanaAuctionClient.deriveItemVaultPDA(
      programId,
      auctionId,
      mint
    );

    const dealerToken = await getAssociatedTokenAddress(mint, wallet.publicKey);

    // Build instruction data
    const dataBuffer = Buffer.alloc(8);
    dataBuffer.writeBigUInt64LE(amount, 0);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: itemPDA, isSigner: false, isWritable: true },
        { pubkey: dealerToken, isSigner: false, isWritable: true },
        { pubkey: itemVaultPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(InstructionType.DepositTokens, dataBuffer),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return { txHash };
  }

  /**
   * Place a bid on a Traditional auction
   */
  async bidTraditional(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    auctionId: Uint8Array,
    amount: bigint,
    previousBidderToken?: PublicKey
  ): Promise<TransactionResult> {
    const programId = new PublicKey(chainInfo.programId);

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
    const [escrowPDA] = SolanaAuctionClient.deriveEscrowPDA(programId, auctionId);

    // Get auction to find payment mint
    const { core } = await this.getAuction(connection, chainInfo, auctionId);
    const paymentMint = new PublicKey(core.paymentToken);
    const bidderToken = await getAssociatedTokenAddress(paymentMint, wallet.publicKey);

    // If no previous bidder token provided, use bidder's own token (will be ignored if no refund needed)
    const prevBidderToken = previousBidderToken || bidderToken;

    // Build instruction data
    const dataBuffer = Buffer.alloc(8);
    dataBuffer.writeBigUInt64LE(amount, 0);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: bidderToken, isSigner: false, isWritable: true },
        { pubkey: prevBidderToken, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(InstructionType.BidTraditional, dataBuffer),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return { txHash };
  }

  /**
   * Buy at current price in a Dutch auction
   */
  async buyDutch(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    auctionId: Uint8Array,
    maxPrice: bigint,
    dealerTokenAccount: PublicKey
  ): Promise<TransactionResult> {
    const programId = new PublicKey(chainInfo.programId);

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);

    // Get auction to find payment mint
    const { core } = await this.getAuction(connection, chainInfo, auctionId);
    const paymentMint = new PublicKey(core.paymentToken);
    const buyerToken = await getAssociatedTokenAddress(paymentMint, wallet.publicKey);
    const [feeVaultPDA] = SolanaAuctionClient.deriveFeeVaultPDA(programId, paymentMint);
    const feeVaultToken = await getAssociatedTokenAddress(paymentMint, feeVaultPDA, true);

    // Build instruction data
    const dataBuffer = Buffer.alloc(8);
    dataBuffer.writeBigUInt64LE(maxPrice, 0);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: buyerToken, isSigner: false, isWritable: true },
        { pubkey: dealerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeVaultToken, isSigner: false, isWritable: true },
        { pubkey: feeVaultPDA, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(InstructionType.BuyDutch, dataBuffer),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return { txHash };
  }

  /**
   * Place a bid on a Penny auction
   */
  async bidPenny(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    auctionId: Uint8Array,
    dealerTokenAccount: PublicKey
  ): Promise<TransactionResult> {
    const programId = new PublicKey(chainInfo.programId);

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);

    // Get auction to find payment mint
    const { core } = await this.getAuction(connection, chainInfo, auctionId);
    const paymentMint = new PublicKey(core.paymentToken);
    const bidderToken = await getAssociatedTokenAddress(paymentMint, wallet.publicKey);
    const [feeVaultPDA] = SolanaAuctionClient.deriveFeeVaultPDA(programId, paymentMint);
    const feeVaultToken = await getAssociatedTokenAddress(paymentMint, feeVaultPDA, true);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: bidderToken, isSigner: false, isWritable: true },
        { pubkey: dealerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeVaultToken, isSigner: false, isWritable: true },
        { pubkey: feeVaultPDA, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(InstructionType.BidPenny, Buffer.alloc(0)),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return { txHash };
  }

  /**
   * Finalize an auction
   */
  async finalizeAuction(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    auctionId: Uint8Array,
    dealerTokenAccount: PublicKey,
    winnerTokenAccount: PublicKey
  ): Promise<TransactionResult> {
    const programId = new PublicKey(chainInfo.programId);

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
    const [escrowPDA] = SolanaAuctionClient.deriveEscrowPDA(programId, auctionId);

    // Get auction to find payment mint
    const { core } = await this.getAuction(connection, chainInfo, auctionId);
    const paymentMint = new PublicKey(core.paymentToken);
    const [feeVaultPDA] = SolanaAuctionClient.deriveFeeVaultPDA(programId, paymentMint);
    const feeVaultToken = await getAssociatedTokenAddress(paymentMint, feeVaultPDA, true);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: dealerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: winnerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeVaultToken, isSigner: false, isWritable: true },
        { pubkey: feeVaultPDA, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(
        InstructionType.FinalizeAuction,
        Buffer.alloc(0)
      ),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return { txHash };
  }

  /**
   * Accept bid below reserve (dealer only)
   */
  async acceptBid(
    wallet: SolanaWallet,
    connection: Connection,
    chainInfo: SolanaChainInfo,
    auctionId: Uint8Array,
    dealerTokenAccount: PublicKey
  ): Promise<TransactionResult> {
    const programId = new PublicKey(chainInfo.programId);

    const [statePDA] = SolanaAuctionClient.deriveProgramStatePDA(programId);
    const [auctionPDA] = SolanaAuctionClient.deriveAuctionPDA(programId, auctionId);
    const [escrowPDA] = SolanaAuctionClient.deriveEscrowPDA(programId, auctionId);

    // Get auction to find payment mint
    const { core } = await this.getAuction(connection, chainInfo, auctionId);
    const paymentMint = new PublicKey(core.paymentToken);
    const [feeVaultPDA] = SolanaAuctionClient.deriveFeeVaultPDA(programId, paymentMint);
    const feeVaultToken = await getAssociatedTokenAddress(paymentMint, feeVaultPDA, true);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: auctionPDA, isSigner: false, isWritable: true },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: dealerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: feeVaultToken, isSigner: false, isWritable: true },
        { pubkey: feeVaultPDA, isSigner: false, isWritable: true },
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: this.buildInstructionData(InstructionType.AcceptBid, Buffer.alloc(0)),
    });

    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    const signedTx = await wallet.signTransaction(transaction);
    const txHash = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txHash);

    return { txHash };
  }
}
