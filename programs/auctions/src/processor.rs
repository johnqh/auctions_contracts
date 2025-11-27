//! Instruction processor

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::{
    error::AuctionError,
    instruction::AuctionInstruction,
    state::ProgramState,
};

/// Process program instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = AuctionInstruction::try_from_slice(instruction_data)
        .map_err(|_| AuctionError::InvalidInstructionData)?;

    match instruction {
        AuctionInstruction::Initialize => process_initialize(program_id, accounts),
        AuctionInstruction::SetPaused { paused } => {
            process_set_paused(program_id, accounts, paused)
        }
        AuctionInstruction::TransferOwnership { new_owner } => {
            process_transfer_ownership(program_id, accounts, new_owner)
        }
        AuctionInstruction::ClaimFees => process_claim_fees(program_id, accounts),
        AuctionInstruction::CreateTraditionalAuction {
            auction_id,
            start_amount,
            increment,
            reserve_price,
            deadline,
        } => process_create_traditional_auction(
            program_id,
            accounts,
            auction_id,
            start_amount,
            increment,
            reserve_price,
            deadline,
        ),
        AuctionInstruction::CreateDutchAuction {
            auction_id,
            start_price,
            decrease_amount,
            interval,
            minimum_price,
            deadline,
        } => process_create_dutch_auction(
            program_id,
            accounts,
            auction_id,
            start_price,
            decrease_amount,
            interval,
            minimum_price,
            deadline,
        ),
        AuctionInstruction::CreatePennyAuction {
            auction_id,
            increment,
            timer_duration,
        } => process_create_penny_auction(
            program_id,
            accounts,
            auction_id,
            increment,
            timer_duration,
        ),
        AuctionInstruction::DepositTokens { amount } => {
            process_deposit_tokens(program_id, accounts, amount)
        }
        AuctionInstruction::DepositNft => process_deposit_nft(program_id, accounts),
        AuctionInstruction::BidTraditional { amount } => {
            process_bid_traditional(program_id, accounts, amount)
        }
        AuctionInstruction::BuyDutch { max_price } => {
            process_buy_dutch(program_id, accounts, max_price)
        }
        AuctionInstruction::BidPenny => process_bid_penny(program_id, accounts),
        AuctionInstruction::FinalizeAuction => process_finalize_auction(program_id, accounts),
        AuctionInstruction::AcceptBid => process_accept_bid(program_id, accounts),
        AuctionInstruction::CloseItemVault { item_index } => {
            process_close_item_vault(program_id, accounts, item_index)
        }
    }
}

/// Initialize program state
fn process_initialize(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let payer = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive state PDA
    let (state_pda, bump) =
        Pubkey::find_program_address(&[ProgramState::SEEDS], program_id);

    if state_pda != *state_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Create state account
    let rent = Rent::get()?;
    let space = ProgramState::LEN + 8; // +8 for discriminator
    let lamports = rent.minimum_balance(space);

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            state_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[payer.clone(), state_account.clone(), system_program.clone()],
        &[&[ProgramState::SEEDS, &[bump]]],
    )?;

    // Initialize state
    let state = ProgramState {
        owner: *payer.key,
        paused: false,
        auction_count: 0,
        bump,
        is_initialized: true,
    };

    state.serialize(&mut &mut state_account.data.borrow_mut()[..])?;

    msg!("Program initialized with owner: {}", payer.key);
    Ok(())
}

/// Set paused state
fn process_set_paused(_program_id: &Pubkey, accounts: &[AccountInfo], paused: bool) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let owner = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;

    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = ProgramState::try_from_slice(&state_account.data.borrow())?;

    if !state.is_initialized {
        return Err(AuctionError::AccountNotInitialized.into());
    }

    if state.owner != *owner.key {
        return Err(AuctionError::OnlyOwner.into());
    }

    state.paused = paused;
    borsh::to_writer(&mut state_account.data.borrow_mut()[..], &state)?;

    msg!("Program paused: {}", paused);
    Ok(())
}

/// Transfer ownership
fn process_transfer_ownership(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    new_owner: Pubkey,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let owner = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;

    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = ProgramState::try_from_slice(&state_account.data.borrow())?;

    if !state.is_initialized {
        return Err(AuctionError::AccountNotInitialized.into());
    }

    if state.owner != *owner.key {
        return Err(AuctionError::OnlyOwner.into());
    }

    let old_owner = state.owner;
    state.owner = new_owner;
    borsh::to_writer(&mut state_account.data.borrow_mut()[..], &state)?;

    msg!("Ownership transferred from {} to {}", old_owner, new_owner);
    Ok(())
}

/// Claim accumulated fees
fn process_claim_fees(_program_id: &Pubkey, _accounts: &[AccountInfo]) -> ProgramResult {
    // TODO: Implement fee claiming
    msg!("ClaimFees not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Create a traditional auction
fn process_create_traditional_auction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _auction_id: [u8; 32],
    _start_amount: u64,
    _increment: u64,
    _reserve_price: u64,
    _deadline: i64,
) -> ProgramResult {
    // TODO: Implement auction creation
    msg!("CreateTraditionalAuction not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Create a Dutch auction
fn process_create_dutch_auction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _auction_id: [u8; 32],
    _start_price: u64,
    _decrease_amount: u64,
    _interval: i64,
    _minimum_price: u64,
    _deadline: i64,
) -> ProgramResult {
    // TODO: Implement auction creation
    msg!("CreateDutchAuction not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Create a Penny auction
fn process_create_penny_auction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _auction_id: [u8; 32],
    _increment: u64,
    _timer_duration: i64,
) -> ProgramResult {
    // TODO: Implement auction creation
    msg!("CreatePennyAuction not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Deposit tokens into auction
fn process_deposit_tokens(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _amount: u64,
) -> ProgramResult {
    // TODO: Implement token deposit
    msg!("DepositTokens not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Deposit NFT into auction
fn process_deposit_nft(_program_id: &Pubkey, _accounts: &[AccountInfo]) -> ProgramResult {
    // TODO: Implement NFT deposit
    msg!("DepositNft not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Place bid on traditional auction
fn process_bid_traditional(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _amount: u64,
) -> ProgramResult {
    // TODO: Implement bidding
    msg!("BidTraditional not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Buy at current Dutch auction price
fn process_buy_dutch(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _max_price: u64,
) -> ProgramResult {
    // TODO: Implement Dutch buy
    msg!("BuyDutch not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Place bid on Penny auction
fn process_bid_penny(_program_id: &Pubkey, _accounts: &[AccountInfo]) -> ProgramResult {
    // TODO: Implement Penny bidding
    msg!("BidPenny not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Finalize auction
fn process_finalize_auction(_program_id: &Pubkey, _accounts: &[AccountInfo]) -> ProgramResult {
    // TODO: Implement finalization
    msg!("FinalizeAuction not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Accept bid below reserve
fn process_accept_bid(_program_id: &Pubkey, _accounts: &[AccountInfo]) -> ProgramResult {
    // TODO: Implement bid acceptance
    msg!("AcceptBid not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

/// Close item vault
fn process_close_item_vault(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _item_index: u8,
) -> ProgramResult {
    // TODO: Implement vault closing
    msg!("CloseItemVault not yet implemented");
    Err(ProgramError::InvalidInstructionData)
}

#[cfg(test)]
mod tests {
    use crate::state::DutchParams;

    #[test]
    fn test_calculate_fee() {
        use crate::state::calculate_fee;

        // 0.5% of 1000 = 5
        let (fee, net) = calculate_fee(1000);
        assert_eq!(fee, 5);
        assert_eq!(net, 995);

        // 0.5% of 10000 = 50
        let (fee, net) = calculate_fee(10000);
        assert_eq!(fee, 50);
        assert_eq!(net, 9950);
    }

    #[test]
    fn test_calculate_dutch_price() {
        use crate::state::calculate_dutch_price;

        let params = DutchParams {
            start_price: 1000,
            decrease_amount: 10,
            interval: 60, // 1 minute
            minimum_price: 100,
            deadline: 0,
            start_time: 0,
        };

        // At start time, price is start_price
        assert_eq!(calculate_dutch_price(&params, 0), 1000);

        // After 1 interval (60s), price decreases by 10
        assert_eq!(calculate_dutch_price(&params, 60), 990);

        // After 5 intervals (300s), price decreases by 50
        assert_eq!(calculate_dutch_price(&params, 300), 950);

        // Price should not go below minimum
        assert_eq!(calculate_dutch_price(&params, 100000), 100);
    }
}
