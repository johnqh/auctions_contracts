//! Program state definitions

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// PDA version for future upgrades
pub const PDA_VERSION: u8 = 1;

/// 24 hours in seconds for dealer acceptance window
pub const ACCEPTANCE_PERIOD: i64 = 24 * 60 * 60;

/// 5 minutes in seconds for Penny auction timer
pub const PENNY_TIMER_DURATION: i64 = 5 * 60;

/// Fee rate in basis points (0.5% = 50)
pub const FEE_RATE: u64 = 50;

/// Fee denominator (basis points)
pub const FEE_DENOMINATOR: u64 = 10000;

/// Auction status
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AuctionStatus {
    /// Auction is live and accepting bids
    Active = 0,
    /// Deadline passed, pending finalization or acceptance
    Expired = 1,
    /// Successfully completed
    Finalized = 2,
    /// Items returned to dealer, bidder refunded
    Refunded = 3,
}

impl Default for AuctionStatus {
    fn default() -> Self {
        Self::Active
    }
}

/// Auction type tag for quick filtering
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AuctionTypeTag {
    Traditional = 0,
    Dutch = 1,
    Penny = 2,
}

impl Default for AuctionTypeTag {
    fn default() -> Self {
        Self::Traditional
    }
}

/// Traditional auction parameters
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct TraditionalParams {
    /// Minimum first bid
    pub start_amount: u64,
    /// Minimum bid increase
    pub increment: u64,
    /// Minimum price to auto-finalize
    pub reserve_price: u64,
    /// Auction end timestamp
    pub deadline: i64,
    /// Dealer acceptance deadline (24h after auction end)
    pub acceptance_deadline: i64,
    /// Whether reserve price was met
    pub reserve_met: bool,
}

/// Dutch auction parameters
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct DutchParams {
    /// Initial price
    pub start_price: u64,
    /// Price decrease per interval
    pub decrease_amount: u64,
    /// Seconds between decreases
    pub interval: i64,
    /// Floor price
    pub minimum_price: u64,
    /// Auction end timestamp
    pub deadline: i64,
    /// When price starts decreasing
    pub start_time: i64,
}

/// Penny auction parameters
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct PennyParams {
    /// Fixed bid increment (paid to dealer)
    pub increment: u64,
    /// Timer reset duration (typically 5 minutes)
    pub timer_duration: i64,
    /// Current deadline (resets on each bid)
    pub current_deadline: i64,
    /// Running total of payments to dealer
    pub total_paid: u64,
    /// Timestamp of last bid
    pub last_bid_time: i64,
}

/// Auction type with embedded parameters
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum AuctionType {
    Traditional(TraditionalParams),
    Dutch(DutchParams),
    Penny(PennyParams),
}

impl Default for AuctionType {
    fn default() -> Self {
        Self::Traditional(TraditionalParams::default())
    }
}

/// Global program state - singleton
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct ProgramState {
    /// Program owner
    pub owner: Pubkey,
    /// Global pause flag
    pub paused: bool,
    /// Total auctions created (for stats)
    pub auction_count: u64,
    /// PDA bump seed
    pub bump: u8,
    /// Initialized flag
    pub is_initialized: bool,
}

impl ProgramState {
    /// Account size
    pub const LEN: usize = 32 + 1 + 8 + 1 + 1; // 43 bytes

    /// Seeds for PDA derivation
    pub const SEEDS: &'static [u8] = b"auction_state";
}

/// Main auction account
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct Auction {
    /// Unique auction ID (32 bytes)
    pub auction_id: [u8; 32],
    /// Schema version for future upgrades
    pub version: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Escrow PDA bump
    pub escrow_bump: u8,
    /// Current status
    pub status: AuctionStatus,
    /// Type tag for quick filtering
    pub auction_type_tag: AuctionTypeTag,

    /// Auction creator
    pub dealer: Pubkey,
    /// Current highest/winning bidder
    pub current_bidder: Pubkey,

    /// SPL token for payment
    pub payment_mint: Pubkey,
    /// Current bid amount
    pub current_bid: u64,

    /// Type-specific parameters
    pub auction_type: AuctionType,

    /// Number of items (max 255 per auction)
    pub item_count: u8,

    /// Creation timestamp
    pub created_at: i64,
    /// Finalization timestamp (0 if not finalized)
    pub finalized_at: i64,

    /// Initialized flag
    pub is_initialized: bool,
}

impl Auction {
    /// Conservative max size
    pub const LEN: usize = 32 + 1 + 1 + 1 + 1 + 1 + 32 + 32 + 32 + 8 + 100 + 1 + 8 + 8 + 1; // ~259 bytes
    /// Account space with discriminator
    pub const SPACE: usize = 8 + Self::LEN + 50; // buffer for future fields
}

/// Tracks items deposited into an auction
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct AuctionItem {
    /// Parent auction ID
    pub auction_id: [u8; 32],
    /// Token/NFT mint address
    pub mint: Pubkey,
    /// Amount (1 for NFTs, variable for fungible)
    pub amount: u64,
    /// True if Metaplex NFT
    pub is_nft: bool,
    /// Item vault PDA bump
    pub vault_bump: u8,
    /// Item index within auction (0-255)
    pub index: u8,
    /// Initialized flag
    pub is_initialized: bool,
}

impl AuctionItem {
    /// Account size
    pub const LEN: usize = 32 + 32 + 8 + 1 + 1 + 1 + 1; // 76 bytes
    /// Account space with discriminator
    pub const SPACE: usize = 8 + Self::LEN;
}

/// Fee vault for accumulated fees
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, Default)]
pub struct FeeVault {
    /// Payment mint this vault is for
    pub payment_mint: Pubkey,
    /// Accumulated fees
    pub amount: u64,
    /// PDA bump seed
    pub bump: u8,
    /// Initialized flag
    pub is_initialized: bool,
}

impl FeeVault {
    /// Account size
    pub const LEN: usize = 32 + 8 + 1 + 1; // 42 bytes
    /// Account space with discriminator
    pub const SPACE: usize = 8 + Self::LEN;
}

/// Calculate fee and net amount
pub fn calculate_fee(amount: u64) -> (u64, u64) {
    let fee = amount.saturating_mul(FEE_RATE) / FEE_DENOMINATOR;
    let net = amount.saturating_sub(fee);
    (fee, net)
}

/// Calculate Dutch auction current price
pub fn calculate_dutch_price(params: &DutchParams, current_time: i64) -> u64 {
    if current_time <= params.start_time {
        return params.start_price;
    }

    let elapsed = current_time.saturating_sub(params.start_time);
    let intervals = elapsed / params.interval;
    let total_decrease = (intervals as u64).saturating_mul(params.decrease_amount);

    let current_price = params.start_price.saturating_sub(total_decrease);
    current_price.max(params.minimum_price)
}
