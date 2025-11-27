//! Multi-Auction Solana Program
//!
//! Supports Traditional, Dutch, and Penny auctions with SPL tokens and NFTs.

pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;

use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

/// Program entrypoint
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    processor::process_instruction(program_id, accounts, instruction_data)
}

// Program ID placeholder - replace with actual deployed program ID
solana_program::declare_id!("AucT1onProgramXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
