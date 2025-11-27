//! Instruction processor

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token::state::Account as TokenAccount;

use crate::{
    error::AuctionError,
    instruction::AuctionInstruction,
    state::{
        calculate_dutch_price, calculate_fee, Auction, AuctionItem, AuctionStatus, AuctionType,
        AuctionTypeTag, DutchParams, FeeVault, PennyParams, ProgramState, TraditionalParams,
        ACCEPTANCE_PERIOD, PDA_VERSION,
    },
};

/// Seeds for auction PDA
const AUCTION_SEED: &[u8] = b"auction";
/// Seeds for escrow PDA
const ESCROW_SEED: &[u8] = b"escrow";
/// Seeds for item vault PDA
const ITEM_VAULT_SEED: &[u8] = b"item_vault";
/// Seeds for fee vault PDA
const FEE_VAULT_SEED: &[u8] = b"fee_vault";
/// Seeds for item account PDA
const ITEM_SEED: &[u8] = b"item";

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
    let (state_pda, bump) = Pubkey::find_program_address(&[ProgramState::SEEDS], program_id);

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
fn process_set_paused(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    paused: bool,
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
fn process_claim_fees(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let owner = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let fee_vault_account = next_account_info(account_iter)?;
    let fee_vault_token = next_account_info(account_iter)?;
    let owner_token = next_account_info(account_iter)?;
    let payment_mint = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let state = ProgramState::try_from_slice(&state_account.data.borrow())?;

    if !state.is_initialized {
        return Err(AuctionError::AccountNotInitialized.into());
    }

    if state.owner != *owner.key {
        return Err(AuctionError::OnlyOwner.into());
    }

    // Derive fee vault PDA
    let (fee_vault_pda, fee_bump) = Pubkey::find_program_address(
        &[FEE_VAULT_SEED, &[PDA_VERSION], payment_mint.key.as_ref()],
        program_id,
    );

    if fee_vault_pda != *fee_vault_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    let mut fee_vault = FeeVault::try_from_slice(&fee_vault_account.data.borrow())?;

    if !fee_vault.is_initialized || fee_vault.amount == 0 {
        return Err(AuctionError::NoItems.into());
    }

    let amount = fee_vault.amount;

    // Transfer fees to owner
    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            fee_vault_token.key,
            owner_token.key,
            &fee_vault_pda,
            &[],
            amount,
        )?,
        &[
            fee_vault_token.clone(),
            owner_token.clone(),
            fee_vault_account.clone(),
            token_program.clone(),
        ],
        &[&[
            FEE_VAULT_SEED,
            &[PDA_VERSION],
            payment_mint.key.as_ref(),
            &[fee_bump],
        ]],
    )?;

    fee_vault.amount = 0;
    borsh::to_writer(&mut fee_vault_account.data.borrow_mut()[..], &fee_vault)?;

    msg!("Claimed {} fees for mint {}", amount, payment_mint.key);
    Ok(())
}

/// Create a traditional auction
fn process_create_traditional_auction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    auction_id: [u8; 32],
    start_amount: u64,
    increment: u64,
    reserve_price: u64,
    deadline: i64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let dealer = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let escrow_account = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let payment_mint = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;
    let rent_sysvar = next_account_info(account_iter)?;

    if !dealer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Check program state
    let mut state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if !state.is_initialized {
        return Err(AuctionError::AccountNotInitialized.into());
    }
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    // Get current time
    let clock = Clock::get()?;
    if deadline <= clock.unix_timestamp {
        return Err(AuctionError::AuctionExpired.into());
    }

    // Derive auction PDA
    let (auction_pda, auction_bump) = Pubkey::find_program_address(
        &[AUCTION_SEED, &[PDA_VERSION], &auction_id],
        program_id,
    );
    if auction_pda != *auction_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Derive escrow PDA
    let (escrow_pda, escrow_bump) = Pubkey::find_program_address(
        &[ESCROW_SEED, &[PDA_VERSION], &auction_id],
        program_id,
    );
    if escrow_pda != *escrow_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Create auction account
    let rent = Rent::from_account_info(rent_sysvar)?;
    let auction_lamports = rent.minimum_balance(Auction::SPACE);

    invoke_signed(
        &system_instruction::create_account(
            dealer.key,
            auction_account.key,
            auction_lamports,
            Auction::SPACE as u64,
            program_id,
        ),
        &[
            dealer.clone(),
            auction_account.clone(),
            system_program.clone(),
        ],
        &[&[AUCTION_SEED, &[PDA_VERSION], &auction_id, &[auction_bump]]],
    )?;

    // Create escrow token account
    let escrow_lamports = rent.minimum_balance(TokenAccount::LEN);

    invoke_signed(
        &system_instruction::create_account(
            dealer.key,
            escrow_account.key,
            escrow_lamports,
            TokenAccount::LEN as u64,
            token_program.key,
        ),
        &[
            dealer.clone(),
            escrow_account.clone(),
            system_program.clone(),
        ],
        &[&[ESCROW_SEED, &[PDA_VERSION], &auction_id, &[escrow_bump]]],
    )?;

    // Initialize escrow token account
    invoke_signed(
        &spl_token::instruction::initialize_account3(
            token_program.key,
            escrow_account.key,
            payment_mint.key,
            &escrow_pda,
        )?,
        &[escrow_account.clone(), payment_mint.clone()],
        &[&[ESCROW_SEED, &[PDA_VERSION], &auction_id, &[escrow_bump]]],
    )?;

    // Initialize auction
    let auction = Auction {
        auction_id,
        version: PDA_VERSION,
        bump: auction_bump,
        escrow_bump,
        status: AuctionStatus::Active,
        auction_type_tag: AuctionTypeTag::Traditional,
        dealer: *dealer.key,
        current_bidder: Pubkey::default(),
        payment_mint: *payment_mint.key,
        current_bid: 0,
        auction_type: AuctionType::Traditional(TraditionalParams {
            start_amount,
            increment,
            reserve_price,
            deadline,
            acceptance_deadline: 0,
            reserve_met: false,
        }),
        item_count: 0,
        created_at: clock.unix_timestamp,
        finalized_at: 0,
        is_initialized: true,
    };

    auction.serialize(&mut &mut auction_account.data.borrow_mut()[..])?;

    // Increment auction count
    state.auction_count = state.auction_count.saturating_add(1);
    borsh::to_writer(&mut state_account.data.borrow_mut()[..], &state)?;

    msg!(
        "Created Traditional auction {} by dealer {}",
        bs58::encode(&auction_id).into_string(),
        dealer.key
    );
    Ok(())
}

/// Create a Dutch auction
fn process_create_dutch_auction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    auction_id: [u8; 32],
    start_price: u64,
    decrease_amount: u64,
    interval: i64,
    minimum_price: u64,
    deadline: i64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let dealer = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let escrow_account = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let payment_mint = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;
    let rent_sysvar = next_account_info(account_iter)?;

    if !dealer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Check program state
    let mut state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if !state.is_initialized {
        return Err(AuctionError::AccountNotInitialized.into());
    }
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    let clock = Clock::get()?;
    if deadline <= clock.unix_timestamp {
        return Err(AuctionError::AuctionExpired.into());
    }

    // Derive auction PDA
    let (auction_pda, auction_bump) = Pubkey::find_program_address(
        &[AUCTION_SEED, &[PDA_VERSION], &auction_id],
        program_id,
    );
    if auction_pda != *auction_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Derive escrow PDA
    let (escrow_pda, escrow_bump) = Pubkey::find_program_address(
        &[ESCROW_SEED, &[PDA_VERSION], &auction_id],
        program_id,
    );
    if escrow_pda != *escrow_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Create auction account
    let rent = Rent::from_account_info(rent_sysvar)?;
    let auction_lamports = rent.minimum_balance(Auction::SPACE);

    invoke_signed(
        &system_instruction::create_account(
            dealer.key,
            auction_account.key,
            auction_lamports,
            Auction::SPACE as u64,
            program_id,
        ),
        &[
            dealer.clone(),
            auction_account.clone(),
            system_program.clone(),
        ],
        &[&[AUCTION_SEED, &[PDA_VERSION], &auction_id, &[auction_bump]]],
    )?;

    // Create escrow token account (for Dutch, used differently)
    let escrow_lamports = rent.minimum_balance(TokenAccount::LEN);

    invoke_signed(
        &system_instruction::create_account(
            dealer.key,
            escrow_account.key,
            escrow_lamports,
            TokenAccount::LEN as u64,
            token_program.key,
        ),
        &[
            dealer.clone(),
            escrow_account.clone(),
            system_program.clone(),
        ],
        &[&[ESCROW_SEED, &[PDA_VERSION], &auction_id, &[escrow_bump]]],
    )?;

    invoke_signed(
        &spl_token::instruction::initialize_account3(
            token_program.key,
            escrow_account.key,
            payment_mint.key,
            &escrow_pda,
        )?,
        &[escrow_account.clone(), payment_mint.clone()],
        &[&[ESCROW_SEED, &[PDA_VERSION], &auction_id, &[escrow_bump]]],
    )?;

    // Initialize auction
    let auction = Auction {
        auction_id,
        version: PDA_VERSION,
        bump: auction_bump,
        escrow_bump,
        status: AuctionStatus::Active,
        auction_type_tag: AuctionTypeTag::Dutch,
        dealer: *dealer.key,
        current_bidder: Pubkey::default(),
        payment_mint: *payment_mint.key,
        current_bid: 0,
        auction_type: AuctionType::Dutch(DutchParams {
            start_price,
            decrease_amount,
            interval,
            minimum_price,
            deadline,
            start_time: clock.unix_timestamp,
        }),
        item_count: 0,
        created_at: clock.unix_timestamp,
        finalized_at: 0,
        is_initialized: true,
    };

    auction.serialize(&mut &mut auction_account.data.borrow_mut()[..])?;

    state.auction_count = state.auction_count.saturating_add(1);
    borsh::to_writer(&mut state_account.data.borrow_mut()[..], &state)?;

    msg!(
        "Created Dutch auction {} by dealer {}",
        bs58::encode(&auction_id).into_string(),
        dealer.key
    );
    Ok(())
}

/// Create a Penny auction
fn process_create_penny_auction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    auction_id: [u8; 32],
    increment: u64,
    timer_duration: i64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let dealer = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let escrow_account = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let payment_mint = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;
    let rent_sysvar = next_account_info(account_iter)?;

    if !dealer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Check program state
    let mut state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if !state.is_initialized {
        return Err(AuctionError::AccountNotInitialized.into());
    }
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    let clock = Clock::get()?;

    // Derive auction PDA
    let (auction_pda, auction_bump) = Pubkey::find_program_address(
        &[AUCTION_SEED, &[PDA_VERSION], &auction_id],
        program_id,
    );
    if auction_pda != *auction_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Derive escrow PDA
    let (escrow_pda, escrow_bump) = Pubkey::find_program_address(
        &[ESCROW_SEED, &[PDA_VERSION], &auction_id],
        program_id,
    );
    if escrow_pda != *escrow_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Create auction account
    let rent = Rent::from_account_info(rent_sysvar)?;
    let auction_lamports = rent.minimum_balance(Auction::SPACE);

    invoke_signed(
        &system_instruction::create_account(
            dealer.key,
            auction_account.key,
            auction_lamports,
            Auction::SPACE as u64,
            program_id,
        ),
        &[
            dealer.clone(),
            auction_account.clone(),
            system_program.clone(),
        ],
        &[&[AUCTION_SEED, &[PDA_VERSION], &auction_id, &[auction_bump]]],
    )?;

    // Create escrow token account (for Penny, holds nothing but needed for consistency)
    let escrow_lamports = rent.minimum_balance(TokenAccount::LEN);

    invoke_signed(
        &system_instruction::create_account(
            dealer.key,
            escrow_account.key,
            escrow_lamports,
            TokenAccount::LEN as u64,
            token_program.key,
        ),
        &[
            dealer.clone(),
            escrow_account.clone(),
            system_program.clone(),
        ],
        &[&[ESCROW_SEED, &[PDA_VERSION], &auction_id, &[escrow_bump]]],
    )?;

    invoke_signed(
        &spl_token::instruction::initialize_account3(
            token_program.key,
            escrow_account.key,
            payment_mint.key,
            &escrow_pda,
        )?,
        &[escrow_account.clone(), payment_mint.clone()],
        &[&[ESCROW_SEED, &[PDA_VERSION], &auction_id, &[escrow_bump]]],
    )?;

    // Initialize auction - Penny auction starts with no deadline until first bid
    let auction = Auction {
        auction_id,
        version: PDA_VERSION,
        bump: auction_bump,
        escrow_bump,
        status: AuctionStatus::Active,
        auction_type_tag: AuctionTypeTag::Penny,
        dealer: *dealer.key,
        current_bidder: Pubkey::default(),
        payment_mint: *payment_mint.key,
        current_bid: 0,
        auction_type: AuctionType::Penny(PennyParams {
            increment,
            timer_duration,
            current_deadline: 0, // Set on first bid
            total_paid: 0,
            last_bid_time: 0,
        }),
        item_count: 0,
        created_at: clock.unix_timestamp,
        finalized_at: 0,
        is_initialized: true,
    };

    auction.serialize(&mut &mut auction_account.data.borrow_mut()[..])?;

    state.auction_count = state.auction_count.saturating_add(1);
    borsh::to_writer(&mut state_account.data.borrow_mut()[..], &state)?;

    msg!(
        "Created Penny auction {} by dealer {}",
        bs58::encode(&auction_id).into_string(),
        dealer.key
    );
    Ok(())
}

/// Deposit tokens into auction
fn process_deposit_tokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let dealer = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let item_account = next_account_info(account_iter)?;
    let dealer_token = next_account_info(account_iter)?;
    let item_vault = next_account_info(account_iter)?;
    let token_mint = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;
    let rent_sysvar = next_account_info(account_iter)?;

    if !dealer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut auction = Auction::try_from_slice(&auction_account.data.borrow())?;

    if !auction.is_initialized {
        return Err(AuctionError::AuctionNotFound.into());
    }
    if auction.dealer != *dealer.key {
        return Err(AuctionError::OnlyDealer.into());
    }
    if auction.status != AuctionStatus::Active {
        return Err(AuctionError::AuctionNotActive.into());
    }
    if auction.item_count >= 255 {
        return Err(AuctionError::MaxItemsExceeded.into());
    }

    let item_index = auction.item_count;

    // Derive item account PDA
    let (item_pda, item_bump) = Pubkey::find_program_address(
        &[
            ITEM_SEED,
            &[PDA_VERSION],
            &auction.auction_id,
            &[item_index],
        ],
        program_id,
    );
    if item_pda != *item_account.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    // Derive item vault PDA
    let (vault_pda, vault_bump) = Pubkey::find_program_address(
        &[
            ITEM_VAULT_SEED,
            &[PDA_VERSION],
            &auction.auction_id,
            token_mint.key.as_ref(),
        ],
        program_id,
    );
    if vault_pda != *item_vault.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    let rent = Rent::from_account_info(rent_sysvar)?;

    // Create item account
    let item_lamports = rent.minimum_balance(AuctionItem::SPACE);
    invoke_signed(
        &system_instruction::create_account(
            dealer.key,
            item_account.key,
            item_lamports,
            AuctionItem::SPACE as u64,
            program_id,
        ),
        &[
            dealer.clone(),
            item_account.clone(),
            system_program.clone(),
        ],
        &[&[
            ITEM_SEED,
            &[PDA_VERSION],
            &auction.auction_id,
            &[item_index],
            &[item_bump],
        ]],
    )?;

    // Create vault token account if needed
    if item_vault.data_is_empty() {
        let vault_lamports = rent.minimum_balance(TokenAccount::LEN);
        invoke_signed(
            &system_instruction::create_account(
                dealer.key,
                item_vault.key,
                vault_lamports,
                TokenAccount::LEN as u64,
                token_program.key,
            ),
            &[dealer.clone(), item_vault.clone(), system_program.clone()],
            &[&[
                ITEM_VAULT_SEED,
                &[PDA_VERSION],
                &auction.auction_id,
                token_mint.key.as_ref(),
                &[vault_bump],
            ]],
        )?;

        invoke_signed(
            &spl_token::instruction::initialize_account3(
                token_program.key,
                item_vault.key,
                token_mint.key,
                &vault_pda,
            )?,
            &[item_vault.clone(), token_mint.clone()],
            &[&[
                ITEM_VAULT_SEED,
                &[PDA_VERSION],
                &auction.auction_id,
                token_mint.key.as_ref(),
                &[vault_bump],
            ]],
        )?;
    }

    // Transfer tokens to vault
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            dealer_token.key,
            item_vault.key,
            dealer.key,
            &[],
            amount,
        )?,
        &[
            dealer_token.clone(),
            item_vault.clone(),
            dealer.clone(),
            token_program.clone(),
        ],
    )?;

    // Initialize item
    let item = AuctionItem {
        auction_id: auction.auction_id,
        mint: *token_mint.key,
        amount,
        is_nft: false,
        vault_bump,
        index: item_index,
        is_initialized: true,
    };
    item.serialize(&mut &mut item_account.data.borrow_mut()[..])?;

    // Update auction
    auction.item_count = auction.item_count.saturating_add(1);
    borsh::to_writer(&mut auction_account.data.borrow_mut()[..], &auction)?;

    msg!("Deposited {} tokens of mint {} to auction", amount, token_mint.key);
    Ok(())
}

/// Deposit NFT into auction
fn process_deposit_nft(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    // NFT deposit is same as token deposit with amount = 1
    process_deposit_tokens(program_id, accounts, 1)
}

/// Place bid on traditional auction
fn process_bid_traditional(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let bidder = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let escrow_account = next_account_info(account_iter)?;
    let bidder_token = next_account_info(account_iter)?;
    let previous_bidder_token = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    if !bidder.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    let mut auction = Auction::try_from_slice(&auction_account.data.borrow())?;

    if !auction.is_initialized {
        return Err(AuctionError::AuctionNotFound.into());
    }
    if auction.status != AuctionStatus::Active {
        return Err(AuctionError::AuctionNotActive.into());
    }

    let clock = Clock::get()?;

    // Get traditional params
    let params = match &auction.auction_type {
        AuctionType::Traditional(p) => p.clone(),
        _ => return Err(AuctionError::InvalidAuctionType.into()),
    };

    if clock.unix_timestamp > params.deadline {
        return Err(AuctionError::AuctionExpired.into());
    }

    // Check bid amount
    let min_bid = if auction.current_bid == 0 {
        params.start_amount
    } else {
        auction
            .current_bid
            .checked_add(params.increment)
            .ok_or(AuctionError::MathOverflow)?
    };

    if amount < min_bid {
        return Err(AuctionError::BidTooLow.into());
    }

    // Derive escrow PDA for signing
    let escrow_seeds = &[
        ESCROW_SEED,
        &[PDA_VERSION],
        &auction.auction_id,
        &[auction.escrow_bump],
    ];

    // Refund previous bidder if exists
    if auction.current_bidder != Pubkey::default() && auction.current_bid > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                escrow_account.key,
                previous_bidder_token.key,
                escrow_account.key,
                &[],
                auction.current_bid,
            )?,
            &[
                escrow_account.clone(),
                previous_bidder_token.clone(),
                escrow_account.clone(),
                token_program.clone(),
            ],
            &[escrow_seeds],
        )?;
        msg!("Refunded {} to previous bidder", auction.current_bid);
    }

    // Transfer new bid to escrow
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            bidder_token.key,
            escrow_account.key,
            bidder.key,
            &[],
            amount,
        )?,
        &[
            bidder_token.clone(),
            escrow_account.clone(),
            bidder.clone(),
            token_program.clone(),
        ],
    )?;

    // Update auction
    auction.current_bidder = *bidder.key;
    auction.current_bid = amount;

    // Update reserve_met flag
    if let AuctionType::Traditional(ref mut p) = auction.auction_type {
        p.reserve_met = amount >= p.reserve_price;
    }

    borsh::to_writer(&mut auction_account.data.borrow_mut()[..], &auction)?;

    msg!("Bid {} placed by {} on auction", amount, bidder.key);
    Ok(())
}

/// Buy at current Dutch auction price
fn process_buy_dutch(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    max_price: u64,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let buyer = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let buyer_token = next_account_info(account_iter)?;
    let dealer_token = next_account_info(account_iter)?;
    let fee_vault_token = next_account_info(account_iter)?;
    let fee_vault_account = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;
    let rent_sysvar = next_account_info(account_iter)?;

    if !buyer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    let mut auction = Auction::try_from_slice(&auction_account.data.borrow())?;

    if !auction.is_initialized {
        return Err(AuctionError::AuctionNotFound.into());
    }
    if auction.status != AuctionStatus::Active {
        return Err(AuctionError::AuctionNotActive.into());
    }
    if auction.item_count == 0 {
        return Err(AuctionError::NoItems.into());
    }

    let clock = Clock::get()?;

    // Get Dutch params
    let params = match &auction.auction_type {
        AuctionType::Dutch(p) => p.clone(),
        _ => return Err(AuctionError::InvalidAuctionType.into()),
    };

    if clock.unix_timestamp > params.deadline {
        return Err(AuctionError::AuctionExpired.into());
    }

    // Calculate current price
    let current_price = calculate_dutch_price(&params, clock.unix_timestamp);

    if current_price > max_price {
        return Err(AuctionError::BidTooLow.into());
    }

    // Calculate fee
    let (fee, net) = calculate_fee(current_price);

    // Ensure fee vault exists
    let (_, fee_vault_bump) = Pubkey::find_program_address(
        &[
            FEE_VAULT_SEED,
            &[PDA_VERSION],
            auction.payment_mint.as_ref(),
        ],
        program_id,
    );

    // Initialize fee vault if needed
    if fee_vault_account.data_is_empty() {
        let rent = Rent::from_account_info(rent_sysvar)?;
        let vault_lamports = rent.minimum_balance(FeeVault::SPACE);

        invoke_signed(
            &system_instruction::create_account(
                buyer.key,
                fee_vault_account.key,
                vault_lamports,
                FeeVault::SPACE as u64,
                program_id,
            ),
            &[
                buyer.clone(),
                fee_vault_account.clone(),
                system_program.clone(),
            ],
            &[&[
                FEE_VAULT_SEED,
                &[PDA_VERSION],
                auction.payment_mint.as_ref(),
                &[fee_vault_bump],
            ]],
        )?;

        let fee_vault = FeeVault {
            payment_mint: auction.payment_mint,
            amount: 0,
            bump: fee_vault_bump,
            is_initialized: true,
        };
        fee_vault.serialize(&mut &mut fee_vault_account.data.borrow_mut()[..])?;
    }

    // Transfer payment to dealer (net after fee)
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            buyer_token.key,
            dealer_token.key,
            buyer.key,
            &[],
            net,
        )?,
        &[
            buyer_token.clone(),
            dealer_token.clone(),
            buyer.clone(),
            token_program.clone(),
        ],
    )?;

    // Transfer fee
    if fee > 0 {
        invoke(
            &spl_token::instruction::transfer(
                token_program.key,
                buyer_token.key,
                fee_vault_token.key,
                buyer.key,
                &[],
                fee,
            )?,
            &[
                buyer_token.clone(),
                fee_vault_token.clone(),
                buyer.clone(),
                token_program.clone(),
            ],
        )?;

        // Update fee vault amount
        let mut fee_vault = FeeVault::try_from_slice(&fee_vault_account.data.borrow())?;
        fee_vault.amount = fee_vault.amount.saturating_add(fee);
        borsh::to_writer(&mut fee_vault_account.data.borrow_mut()[..], &fee_vault)?;
    }

    // Update auction
    auction.current_bidder = *buyer.key;
    auction.current_bid = current_price;
    auction.status = AuctionStatus::Finalized;
    auction.finalized_at = clock.unix_timestamp;

    borsh::to_writer(&mut auction_account.data.borrow_mut()[..], &auction)?;

    msg!(
        "Dutch auction bought by {} at price {} (fee: {}, net: {})",
        buyer.key,
        current_price,
        fee,
        net
    );
    Ok(())
}

/// Place bid on Penny auction
fn process_bid_penny(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let bidder = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let bidder_token = next_account_info(account_iter)?;
    let dealer_token = next_account_info(account_iter)?;
    let fee_vault_token = next_account_info(account_iter)?;
    let fee_vault_account = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;
    let rent_sysvar = next_account_info(account_iter)?;

    if !bidder.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    let mut auction = Auction::try_from_slice(&auction_account.data.borrow())?;

    if !auction.is_initialized {
        return Err(AuctionError::AuctionNotFound.into());
    }
    if auction.status != AuctionStatus::Active {
        return Err(AuctionError::AuctionNotActive.into());
    }

    let clock = Clock::get()?;

    // Get Penny params
    let mut params = match &auction.auction_type {
        AuctionType::Penny(p) => p.clone(),
        _ => return Err(AuctionError::InvalidAuctionType.into()),
    };

    // Check if timer expired (if there was a previous bid)
    if params.current_deadline > 0 && clock.unix_timestamp > params.current_deadline {
        return Err(AuctionError::AuctionExpired.into());
    }

    // Calculate fee on increment
    let (fee, net) = calculate_fee(params.increment);

    // Ensure fee vault exists
    let (_, fee_vault_bump) = Pubkey::find_program_address(
        &[
            FEE_VAULT_SEED,
            &[PDA_VERSION],
            auction.payment_mint.as_ref(),
        ],
        program_id,
    );

    // Initialize fee vault if needed
    if fee_vault_account.data_is_empty() {
        let rent = Rent::from_account_info(rent_sysvar)?;
        let vault_lamports = rent.minimum_balance(FeeVault::SPACE);

        invoke_signed(
            &system_instruction::create_account(
                bidder.key,
                fee_vault_account.key,
                vault_lamports,
                FeeVault::SPACE as u64,
                program_id,
            ),
            &[
                bidder.clone(),
                fee_vault_account.clone(),
                system_program.clone(),
            ],
            &[&[
                FEE_VAULT_SEED,
                &[PDA_VERSION],
                auction.payment_mint.as_ref(),
                &[fee_vault_bump],
            ]],
        )?;

        let fee_vault = FeeVault {
            payment_mint: auction.payment_mint,
            amount: 0,
            bump: fee_vault_bump,
            is_initialized: true,
        };
        fee_vault.serialize(&mut &mut fee_vault_account.data.borrow_mut()[..])?;
    }

    // Transfer payment to dealer (net after fee)
    invoke(
        &spl_token::instruction::transfer(
            token_program.key,
            bidder_token.key,
            dealer_token.key,
            bidder.key,
            &[],
            net,
        )?,
        &[
            bidder_token.clone(),
            dealer_token.clone(),
            bidder.clone(),
            token_program.clone(),
        ],
    )?;

    // Transfer fee
    if fee > 0 {
        invoke(
            &spl_token::instruction::transfer(
                token_program.key,
                bidder_token.key,
                fee_vault_token.key,
                bidder.key,
                &[],
                fee,
            )?,
            &[
                bidder_token.clone(),
                fee_vault_token.clone(),
                bidder.clone(),
                token_program.clone(),
            ],
        )?;

        // Update fee vault amount
        let mut fee_vault = FeeVault::try_from_slice(&fee_vault_account.data.borrow())?;
        fee_vault.amount = fee_vault.amount.saturating_add(fee);
        borsh::to_writer(&mut fee_vault_account.data.borrow_mut()[..], &fee_vault)?;
    }

    // Update params
    params.total_paid = params.total_paid.saturating_add(params.increment);
    params.last_bid_time = clock.unix_timestamp;
    params.current_deadline = clock.unix_timestamp.saturating_add(params.timer_duration);

    // Update auction
    auction.current_bidder = *bidder.key;
    auction.current_bid = params.total_paid;
    auction.auction_type = AuctionType::Penny(params.clone());

    borsh::to_writer(&mut auction_account.data.borrow_mut()[..], &auction)?;

    msg!(
        "Penny bid by {} - total paid: {}, new deadline: {}",
        bidder.key,
        params.total_paid,
        params.current_deadline
    );
    Ok(())
}

/// Finalize auction
fn process_finalize_auction(_program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let _caller = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let escrow_account = next_account_info(account_iter)?;
    let dealer_token = next_account_info(account_iter)?;
    let winner_token = next_account_info(account_iter)?;
    let fee_vault_token = next_account_info(account_iter)?;
    let fee_vault_account = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    let state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    let mut auction = Auction::try_from_slice(&auction_account.data.borrow())?;

    if !auction.is_initialized {
        return Err(AuctionError::AuctionNotFound.into());
    }
    if auction.status != AuctionStatus::Active && auction.status != AuctionStatus::Expired {
        return Err(AuctionError::AuctionNotActive.into());
    }

    let clock = Clock::get()?;

    let escrow_seeds = &[
        ESCROW_SEED,
        &[PDA_VERSION],
        &auction.auction_id,
        &[auction.escrow_bump],
    ];

    match &auction.auction_type {
        AuctionType::Traditional(params) => {
            // Check if deadline passed
            if clock.unix_timestamp <= params.deadline {
                return Err(AuctionError::AuctionNotExpired.into());
            }

            if auction.current_bidder == Pubkey::default() {
                // No bids - return items to dealer
                auction.status = AuctionStatus::Refunded;
                auction.finalized_at = clock.unix_timestamp;
            } else if params.reserve_met {
                // Reserve met - complete sale
                let (fee, net) = calculate_fee(auction.current_bid);

                // Transfer payment to dealer
                invoke_signed(
                    &spl_token::instruction::transfer(
                        token_program.key,
                        escrow_account.key,
                        dealer_token.key,
                        escrow_account.key,
                        &[],
                        net,
                    )?,
                    &[
                        escrow_account.clone(),
                        dealer_token.clone(),
                        escrow_account.clone(),
                        token_program.clone(),
                    ],
                    &[escrow_seeds],
                )?;

                // Transfer fee
                if fee > 0 {
                    invoke_signed(
                        &spl_token::instruction::transfer(
                            token_program.key,
                            escrow_account.key,
                            fee_vault_token.key,
                            escrow_account.key,
                            &[],
                            fee,
                        )?,
                        &[
                            escrow_account.clone(),
                            fee_vault_token.clone(),
                            escrow_account.clone(),
                            token_program.clone(),
                        ],
                        &[escrow_seeds],
                    )?;

                    // Update fee vault
                    if !fee_vault_account.data_is_empty() {
                        let mut fee_vault =
                            FeeVault::try_from_slice(&fee_vault_account.data.borrow())?;
                        fee_vault.amount = fee_vault.amount.saturating_add(fee);
                        borsh::to_writer(&mut fee_vault_account.data.borrow_mut()[..], &fee_vault)?;
                    }
                }

                auction.status = AuctionStatus::Finalized;
                auction.finalized_at = clock.unix_timestamp;
            } else {
                // Reserve not met - check acceptance period
                let acceptance_deadline = params.deadline.saturating_add(ACCEPTANCE_PERIOD);

                if clock.unix_timestamp <= acceptance_deadline {
                    // Still in acceptance period - set status to expired
                    auction.status = AuctionStatus::Expired;
                    if let AuctionType::Traditional(ref mut p) = auction.auction_type {
                        p.acceptance_deadline = acceptance_deadline;
                    }
                } else {
                    // Acceptance period expired - refund bidder
                    invoke_signed(
                        &spl_token::instruction::transfer(
                            token_program.key,
                            escrow_account.key,
                            winner_token.key,
                            escrow_account.key,
                            &[],
                            auction.current_bid,
                        )?,
                        &[
                            escrow_account.clone(),
                            winner_token.clone(),
                            escrow_account.clone(),
                            token_program.clone(),
                        ],
                        &[escrow_seeds],
                    )?;

                    auction.status = AuctionStatus::Refunded;
                    auction.finalized_at = clock.unix_timestamp;
                }
            }
        }
        AuctionType::Dutch(params) => {
            // Dutch auction - if deadline passed with no buyer, refund to dealer
            if clock.unix_timestamp <= params.deadline {
                return Err(AuctionError::AuctionNotExpired.into());
            }

            auction.status = AuctionStatus::Refunded;
            auction.finalized_at = clock.unix_timestamp;
        }
        AuctionType::Penny(params) => {
            // Penny auction - check timer expiry
            if params.current_deadline == 0 {
                // No bids yet
                return Err(AuctionError::NoBidder.into());
            }

            if clock.unix_timestamp <= params.current_deadline {
                return Err(AuctionError::PennyTimerNotExpired.into());
            }

            // Timer expired - winner gets items (payment already sent during bidding)
            auction.status = AuctionStatus::Finalized;
            auction.finalized_at = clock.unix_timestamp;
        }
    }

    borsh::to_writer(&mut auction_account.data.borrow_mut()[..], &auction)?;

    msg!("Auction finalized with status: {:?}", auction.status);
    Ok(())
}

/// Accept bid below reserve
fn process_accept_bid(_program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let dealer = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let escrow_account = next_account_info(account_iter)?;
    let dealer_token = next_account_info(account_iter)?;
    let fee_vault_token = next_account_info(account_iter)?;
    let fee_vault_account = next_account_info(account_iter)?;
    let state_account = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    if !dealer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let state = ProgramState::try_from_slice(&state_account.data.borrow())?;
    if state.paused {
        return Err(AuctionError::ContractPaused.into());
    }

    let mut auction = Auction::try_from_slice(&auction_account.data.borrow())?;

    if !auction.is_initialized {
        return Err(AuctionError::AuctionNotFound.into());
    }
    if auction.dealer != *dealer.key {
        return Err(AuctionError::OnlyDealer.into());
    }
    if auction.status != AuctionStatus::Expired {
        return Err(AuctionError::AuctionNotActive.into());
    }
    if auction.current_bidder == Pubkey::default() {
        return Err(AuctionError::NoBidder.into());
    }

    let clock = Clock::get()?;

    // Get traditional params and check acceptance deadline
    let params = match &auction.auction_type {
        AuctionType::Traditional(p) => p.clone(),
        _ => return Err(AuctionError::InvalidAuctionType.into()),
    };

    if params.acceptance_deadline > 0 && clock.unix_timestamp > params.acceptance_deadline {
        return Err(AuctionError::AcceptancePeriodExpired.into());
    }

    let escrow_seeds = &[
        ESCROW_SEED,
        &[PDA_VERSION],
        &auction.auction_id,
        &[auction.escrow_bump],
    ];

    // Calculate fee
    let (fee, net) = calculate_fee(auction.current_bid);

    // Transfer payment to dealer
    invoke_signed(
        &spl_token::instruction::transfer(
            token_program.key,
            escrow_account.key,
            dealer_token.key,
            escrow_account.key,
            &[],
            net,
        )?,
        &[
            escrow_account.clone(),
            dealer_token.clone(),
            escrow_account.clone(),
            token_program.clone(),
        ],
        &[escrow_seeds],
    )?;

    // Transfer fee
    if fee > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                escrow_account.key,
                fee_vault_token.key,
                escrow_account.key,
                &[],
                fee,
            )?,
            &[
                escrow_account.clone(),
                fee_vault_token.clone(),
                escrow_account.clone(),
                token_program.clone(),
            ],
            &[escrow_seeds],
        )?;

        // Update fee vault
        if !fee_vault_account.data_is_empty() {
            let mut fee_vault = FeeVault::try_from_slice(&fee_vault_account.data.borrow())?;
            fee_vault.amount = fee_vault.amount.saturating_add(fee);
            borsh::to_writer(&mut fee_vault_account.data.borrow_mut()[..], &fee_vault)?;
        }
    }

    // Update auction
    auction.status = AuctionStatus::Finalized;
    auction.finalized_at = clock.unix_timestamp;

    borsh::to_writer(&mut auction_account.data.borrow_mut()[..], &auction)?;

    msg!(
        "Dealer accepted bid of {} (fee: {}, net: {})",
        auction.current_bid,
        fee,
        net
    );
    Ok(())
}

/// Close item vault
fn process_close_item_vault(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    item_index: u8,
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;
    let auction_account = next_account_info(account_iter)?;
    let item_account = next_account_info(account_iter)?;
    let item_vault = next_account_info(account_iter)?;
    let recipient_token = next_account_info(account_iter)?;
    let rent_recipient = next_account_info(account_iter)?;
    let token_program = next_account_info(account_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let auction = Auction::try_from_slice(&auction_account.data.borrow())?;

    if !auction.is_initialized {
        return Err(AuctionError::AuctionNotFound.into());
    }

    // Only allow closing after finalization
    if auction.status != AuctionStatus::Finalized && auction.status != AuctionStatus::Refunded {
        return Err(AuctionError::AuctionNotActive.into());
    }

    // Authority must be dealer or winner
    let is_winner = auction.current_bidder == *authority.key;
    let is_dealer = auction.dealer == *authority.key;

    if !is_winner && !is_dealer {
        return Err(AuctionError::OnlyDealer.into());
    }

    let item = AuctionItem::try_from_slice(&item_account.data.borrow())?;

    if !item.is_initialized || item.index != item_index {
        return Err(AuctionError::NoItems.into());
    }

    // Derive vault PDA
    let (vault_pda, vault_bump) = Pubkey::find_program_address(
        &[
            ITEM_VAULT_SEED,
            &[PDA_VERSION],
            &auction.auction_id,
            item.mint.as_ref(),
        ],
        program_id,
    );

    if vault_pda != *item_vault.key {
        return Err(AuctionError::InvalidPDA.into());
    }

    let vault_seeds = &[
        ITEM_VAULT_SEED,
        &[PDA_VERSION],
        &auction.auction_id,
        item.mint.as_ref(),
        &[vault_bump],
    ];

    // Transfer tokens to recipient
    let vault_token = TokenAccount::unpack(&item_vault.data.borrow())?;

    if vault_token.amount > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                token_program.key,
                item_vault.key,
                recipient_token.key,
                &vault_pda,
                &[],
                vault_token.amount,
            )?,
            &[
                item_vault.clone(),
                recipient_token.clone(),
                item_vault.clone(),
                token_program.clone(),
            ],
            &[vault_seeds],
        )?;
    }

    // Close token account
    invoke_signed(
        &spl_token::instruction::close_account(
            token_program.key,
            item_vault.key,
            rent_recipient.key,
            &vault_pda,
            &[],
        )?,
        &[
            item_vault.clone(),
            rent_recipient.clone(),
            item_vault.clone(),
            token_program.clone(),
        ],
        &[vault_seeds],
    )?;

    // Close item account - transfer lamports to rent recipient
    let item_lamports = item_account.lamports();
    **item_account.lamports.borrow_mut() = 0;
    **rent_recipient.lamports.borrow_mut() = rent_recipient
        .lamports()
        .checked_add(item_lamports)
        .ok_or(AuctionError::MathOverflow)?;

    msg!("Closed item vault {} for auction", item_index);
    Ok(())
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
