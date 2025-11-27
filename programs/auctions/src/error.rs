//! Program errors

use solana_program::program_error::ProgramError;
use thiserror::Error;

/// Auction program errors
#[derive(Error, Debug, Copy, Clone)]
pub enum AuctionError {
    #[error("Only the owner can perform this action")]
    OnlyOwner,

    #[error("Only the dealer can perform this action")]
    OnlyDealer,

    #[error("Contract is paused")]
    ContractPaused,

    #[error("Auction not found")]
    AuctionNotFound,

    #[error("Auction is not active")]
    AuctionNotActive,

    #[error("Auction deadline has passed")]
    AuctionExpired,

    #[error("Auction deadline has not passed")]
    AuctionNotExpired,

    #[error("Bid amount too low")]
    BidTooLow,

    #[error("Invalid auction type for this operation")]
    InvalidAuctionType,

    #[error("Reserve price not met")]
    ReservePriceNotMet,

    #[error("Acceptance period expired")]
    AcceptancePeriodExpired,

    #[error("Acceptance period not expired")]
    AcceptancePeriodNotExpired,

    #[error("No items in auction")]
    NoItems,

    #[error("Maximum items exceeded")]
    MaxItemsExceeded,

    #[error("Invalid NFT metadata")]
    InvalidNftMetadata,

    #[error("Math overflow")]
    MathOverflow,

    #[error("Invalid PDA")]
    InvalidPDA,

    #[error("Invalid payment mint")]
    InvalidPaymentMint,

    #[error("Penny auction timer not expired")]
    PennyTimerNotExpired,

    #[error("No bidder to accept")]
    NoBidder,

    #[error("Invalid account owner")]
    InvalidAccountOwner,

    #[error("Invalid instruction data")]
    InvalidInstructionData,

    #[error("Account not initialized")]
    AccountNotInitialized,

    #[error("Account already initialized")]
    AccountAlreadyInitialized,
}

impl From<AuctionError> for ProgramError {
    fn from(e: AuctionError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
