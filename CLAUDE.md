# CLAUDE.md - Auctions Contracts

This file provides context for Claude Code when working on this project.

## Project Overview

Multi-chain auction system supporting Solana (Rust/Anchor) and EVM (Solidity/Hardhat). Implements three auction types: Traditional, Dutch, and Penny.

- **Package**: `@sudobility/auctions_contracts`
- **Stack**: Solidity 0.8.24, Rust/Anchor 0.28.0 (edition 2021), TypeScript, Hardhat, Viem
- **License**: BUSL-1.1
- **Package manager**: Bun

## Quick Commands

```bash
bun run build              # Build everything (EVM + Solana + Unified + React Native)
bun run build:ci           # Build unified + react-native only (no EVM/Solana compile)
bun run compile:evm        # Compile Solidity contracts only
bun run test               # Run EVM tests (alias for test:evm)
bun run test:evm           # Run EVM tests (Hardhat + viem)
bun run test:solana        # Run Solana tests (cargo test)
bun run test:ci            # Build unified then run unified tests directly
bun run test:unified       # Run unified tests from dist (must build first)
bun run lint               # ESLint check
bun run lint:fix           # ESLint with auto-fix
bun run typecheck          # TypeScript compilation check
bun run format             # Prettier formatting
bun run format:check       # Prettier check (no write)
bun run clean              # Hardhat clean
```

## Project Structure

```
auctions_contracts/
├── contracts/                    # Solidity contracts (EVM)
│   ├── core/
│   │   ├── AuctionRegistry.sol       # Main auction contract (UUPS upgradeable)
│   │   └── AuctionRegistryStorage.sol # Storage layout (uses __gap pattern)
│   ├── interfaces/
│   │   ├── IAuctionRegistry.sol      # Main interface
│   │   ├── IAuctionEvents.sol        # Event definitions
│   │   └── IAuctionTypes.sol         # Shared type enums
│   ├── libraries/
│   │   ├── FeeLib.sol                # Fee calculation (0.5% default, 10% max)
│   │   └── TokenTransferLib.sol      # ERC20/721/1155 transfer utilities
│   └── test/mocks/                   # Mock tokens for testing
├── programs/auctions/src/        # Solana program (Rust/Anchor)
│   ├── lib.rs                        # Entrypoint
│   ├── state.rs                      # State definitions & enums
│   ├── instruction.rs                # Instruction definitions
│   ├── error.rs                      # Error types (24 custom errors)
│   └── processor.rs                  # Main processor (15 handlers, ~1813 lines)
├── src/                          # TypeScript SDK
│   ├── unified/                      # Chain-agnostic client (lazy-loads EVM/Solana)
│   ├── evm/                          # Viem-based EVM client
│   ├── solana/                       # Web3.js-based Solana client
│   ├── react-native/                 # React Native entry (directory does not exist yet)
│   ├── types/common.ts               # Shared types, validators, & utility functions
│   └── utils/
├── test/                         # Test suites
├── typechain-types/              # Generated types from Solidity
├── hardhat.config.cts            # Hardhat configuration
├── Anchor.toml                   # Anchor configuration
├── Cargo.toml                    # Rust workspace
├── tsconfig.json                 # Base TypeScript config
├── tsconfig.evm.json             # EVM build config
├── tsconfig.solana.json          # Solana build config
├── tsconfig.unified.json         # Unified client build config
├── tsconfig.react-native.json    # React Native build config
└── tsconfig.test.json            # Test build config
```

## Auction Types

### Traditional Auction

- English-style ascending bids with reserve price
- Minimum increment enforced
- If reserve met: auto-finalize after deadline
- If reserve not met: 24-hour acceptance period for dealer

### Dutch Auction

- Descending price: `price = start_price - (intervals * decrease_amount)`
- Price floors at minimum_price
- First buyer wins immediately

### Penny Auction

- Fixed bid increment (pay-to-bid model)
- Each bid resets a 5-minute timer
- Last bidder when timer expires wins all items

## Key Constants

```
FEE_RATE: 50 (0.5% in basis points)
FEE_DENOMINATOR: 10000
MAX_FEE_RATE: 1000 (10%)
ACCEPTANCE_PERIOD: 24 hours
PENNY_TIMER_DURATION: 5 minutes
MAX_ITEMS_PER_AUCTION: 255
PDA_VERSION: 1
```

## Architecture Patterns

### EVM (Solidity)

- **UUPS Upgradeable Proxy** pattern for all contracts
- **Storage gap (`__gap`)**: `uint256[50] private __gap` in AuctionRegistryStorage for future storage slot reservation
- **Storage layout** separated from logic (AuctionRegistryStorage)
- **CEI pattern**: State changes before external calls
- **SafeERC20** for all token transfers
- **Reentrancy guard** on state-modifying functions

### Solana (Rust)

- **Rust edition 2021**, solana-program 1.18, borsh 0.10
- **PDA-based accounting** with deterministic address derivation
- **Borsh serialization** for all state
- **Saturating arithmetic** to prevent overflows
- **Version field** on PDAs for future upgrade path

### Unified Client Lazy-Loading

The `OnchainAuctionClient` in `src/unified/` uses dynamic `import()` to lazy-load platform-specific clients (EVM or Solana) on first use. This keeps bundle size minimal when consumers only use one chain. Static class properties cache the loaded client instances.

### PDA Derivation (Solana)

```
Program State: ["auction_state"]
Auction:       ["auction", version_byte, auction_id]
Escrow:        ["escrow", version_byte, auction_id]
Item:          ["item", version_byte, auction_id, item_index]
Item Vault:    ["item_vault", version_byte, auction_id, token_mint]
Fee Vault:     ["fee_vault", version_byte, payment_mint]
```

## TypeScript SDK

Four export points:

- `@sudobility/auctions_contracts` - Unified client (default)
- `@sudobility/auctions_contracts/evm` - EVM-specific (viem)
- `@sudobility/auctions_contracts/solana` - Solana-specific (web3.js)
- `@sudobility/auctions_contracts/react-native` - React Native entry

### Key Exports from `src/types/common.ts`

**Enums**: `AuctionType`, `AuctionStatus`, `ItemType`, `ChainType`

**Interfaces**: `AuctionItem`, `AuctionCore`, `TraditionalParams`, `DutchParams`, `PennyParams`, `Auction`, `CreateTraditionalAuctionParams`, `CreateDutchAuctionParams`, `CreatePennyAuctionParams`, `TransactionResult`, `ChainInfo`, `ValidationResult`

**Utility functions**: `calculateFee()`, `calculateDutchPrice()`, `calculateTimeRemaining()`, `formatAuctionType()`, `formatAuctionStatus()`, `formatItemType()`, `formatAmount()`, `parseAmount()`, `validateTraditionalParams()`, `validateDutchParams()`, `validatePennyParams()`, `validateTraditionalBid()`, `isTraditionalAuctionActive()`, `isDutchAuctionActive()`, `isPennyAuctionActive()`

**Constants**: `PROTOCOL_CONSTANTS`

## Supported Networks

**EVM**: Ethereum, Sepolia, Polygon, Optimism, Base, Arbitrum
**Solana**: Localnet, Devnet, Mainnet-beta

## Deployment

```bash
bun run deploy:evm:local       # Deploy to Hardhat localhost
bun run deploy:evm:sepolia     # Deploy to Sepolia
bun run deploy:solana:devnet   # Deploy to Solana devnet
```

## Solana Dependencies

```
solana-program = "1.18"
spl-token = "4.0"
spl-associated-token-account = "3.0"
borsh = "0.10"
thiserror = "1.0"
bs58 = "0.5"
```

## CI/CD

Uses `johnqh/workflows/.github/workflows/unified-cicd.yml@main` reusable workflow with automatic NPM publishing.

## Dependencies

- `@openzeppelin/contracts` 5.4.0 (EVM standards)
- `viem` 2.38.4 (EVM interactions)
- `@solana/web3.js` 1.98.4 (Solana interactions)
- `hardhat` 2.26.3 (build/test)
- `mocha` + `chai` (testing)
