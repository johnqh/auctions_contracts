//! Program instructions

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

/// Auction program instructions
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum AuctionInstruction {
    // ============ Program Management ============
    /// Initialize the program state
    /// Accounts:
    /// 0. `[signer]` Payer
    /// 1. `[writable]` Program state PDA
    /// 2. `[]` System program
    Initialize,

    /// Pause/unpause all auctions globally
    /// Accounts:
    /// 0. `[signer]` Owner
    /// 1. `[writable]` Program state PDA
    SetPaused { paused: bool },

    /// Transfer ownership
    /// Accounts:
    /// 0. `[signer]` Current owner
    /// 1. `[writable]` Program state PDA
    TransferOwnership { new_owner: Pubkey },

    /// Claim accumulated fees for a specific payment token
    /// Accounts:
    /// 0. `[signer]` Owner
    /// 1. `[]` Program state PDA
    /// 2. `[writable]` Fee vault PDA
    /// 3. `[writable]` Fee vault token account
    /// 4. `[writable]` Owner token account
    /// 5. `[]` Token program
    ClaimFees,

    // ============ Auction Creation ============
    /// Create a traditional auction
    /// Accounts:
    /// 0. `[signer]` Dealer
    /// 1. `[writable]` Auction account PDA
    /// 2. `[writable]` Escrow token account PDA
    /// 3. `[]` Program state PDA
    /// 4. `[]` Payment mint
    /// 5. `[]` Token program
    /// 6. `[]` System program
    CreateTraditionalAuction {
        auction_id: [u8; 32],
        start_amount: u64,
        increment: u64,
        reserve_price: u64,
        deadline: i64,
    },

    /// Create a Dutch auction
    /// Accounts: (same as Traditional)
    CreateDutchAuction {
        auction_id: [u8; 32],
        start_price: u64,
        decrease_amount: u64,
        interval: i64,
        minimum_price: u64,
        deadline: i64,
    },

    /// Create a Penny auction
    /// Accounts: (same as Traditional)
    CreatePennyAuction {
        auction_id: [u8; 32],
        increment: u64,
        timer_duration: i64,
    },

    // ============ Item Management ============
    /// Deposit SPL tokens into auction
    /// Accounts:
    /// 0. `[signer]` Dealer
    /// 1. `[writable]` Auction account
    /// 2. `[writable]` Item account PDA
    /// 3. `[writable]` Dealer token account
    /// 4. `[writable]` Item vault token account PDA
    /// 5. `[]` Token mint
    /// 6. `[]` Token program
    /// 7. `[]` System program
    DepositTokens { amount: u64 },

    /// Deposit NFT into auction (Metaplex)
    /// Accounts: (same as DepositTokens + metadata account)
    DepositNft,

    // ============ Bidding ============
    /// Place bid on Traditional auction
    /// Accounts:
    /// 0. `[signer]` Bidder
    /// 1. `[writable]` Auction account
    /// 2. `[writable]` Escrow token account
    /// 3. `[writable]` Bidder token account
    /// 4. `[writable]` Previous bidder token account (for refund)
    /// 5. `[]` Program state
    /// 6. `[]` Token program
    /// 7. `[]` Clock sysvar
    BidTraditional { amount: u64 },

    /// Buy at current price in Dutch auction
    /// Accounts:
    /// 0. `[signer]` Buyer
    /// 1. `[writable]` Auction account
    /// 2. `[writable]` Buyer token account
    /// 3. `[writable]` Dealer token account
    /// 4. `[writable]` Fee vault token account
    /// 5. `[writable]` Item vault(s)
    /// 6. `[writable]` Buyer item account(s)
    /// 7. `[]` Program state
    /// 8. `[]` Token program
    /// 9. `[]` Clock sysvar
    BuyDutch { max_price: u64 },

    /// Place bid on Penny auction
    /// Accounts:
    /// 0. `[signer]` Bidder
    /// 1. `[writable]` Auction account
    /// 2. `[writable]` Bidder token account
    /// 3. `[writable]` Dealer token account
    /// 4. `[writable]` Fee vault token account
    /// 5. `[]` Program state
    /// 6. `[]` Token program
    /// 7. `[]` Clock sysvar
    BidPenny,

    // ============ Finalization ============
    /// Finalize auction (permissionless when conditions met)
    /// Accounts vary by auction type and state
    FinalizeAuction,

    /// Dealer accepts bid below reserve (Traditional only)
    /// Accounts:
    /// 0. `[signer]` Dealer
    /// 1. `[writable]` Auction account
    /// 2. `[writable]` Escrow token account
    /// 3. `[writable]` Dealer token account
    /// 4. `[writable]` Fee vault token account
    /// 5. `[writable]` Item vault(s)
    /// 6. `[writable]` Winner item account(s)
    /// 7. `[]` Program state
    /// 8. `[]` Token program
    /// 9. `[]` Clock sysvar
    AcceptBid,

    // ============ Cleanup ============
    /// Close item vault and recover rent (after finalization)
    /// Accounts:
    /// 0. `[signer]` Dealer or auction payer
    /// 1. `[writable]` Item account
    /// 2. `[writable]` Item vault token account
    /// 3. `[writable]` Rent recipient
    /// 4. `[]` Token program
    CloseItemVault { item_index: u8 },
}
