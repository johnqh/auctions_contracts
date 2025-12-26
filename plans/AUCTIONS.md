# Multi-Auction Contracts Implementation Plan

## Overview

A multi-chain auction system supporting Traditional, Dutch, and Penny auctions with ERC-20/721/1155 tokens on EVM and SPL/NFTs on Solana. Project structure follows `~/0xmail/mail_box_contracts` patterns.

## Requirements Summary

| Aspect | Decision |
| ------ | -------- |
| Auction Types | Traditional, Dutch, Penny |
| Item Types | ERC-20, ERC-721, ERC-1155 (batch support) |
| Architecture | Registry pattern (single contract) |
| Payment | Any ERC-20/SPL token (dealer specifies) |
| Fee | 0.5% to owner on dealer payments |
| Pause | Global pause by owner, no cancel |
| Refunds | Push (automatic) on outbid |
| Upgradability | UUPS proxy (EVM) / Native upgrades (Solana) |
| Solana Framework | Native (not Anchor) |

---

## Project Structure

```text
auctions_contracts/
├── contracts/                    # EVM Solidity contracts
│   ├── core/
│   │   ├── AuctionRegistry.sol       # Main UUPS upgradeable contract
│   │   └── AuctionRegistryStorage.sol # Storage layout
│   ├── interfaces/
│   │   ├── IAuctionRegistry.sol      # Main interface
│   │   ├── IAuctionTypes.sol         # Enums and structs
│   │   └── IAuctionEvents.sol        # Events
│   ├── libraries/
│   │   ├── TokenTransferLib.sol      # ERC-20/721/1155 transfers
│   │   └── FeeLib.sol                # Fee calculation (0.5%)
│   └── test/
│       └── mocks/                    # MockERC20, MockERC721, MockERC1155
│
├── programs/auctions/            # Solana Native program
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                    # Entry point + processors
│       ├── state.rs                  # Account structures
│       ├── instruction.rs            # Instruction enum
│       ├── error.rs                  # Custom errors
│       └── cpi.rs                    # Cross-program invocations
│
├── src/                          # TypeScript clients
│   ├── evm/
│   │   ├── evm-auction-client.ts
│   │   └── index.ts
│   ├── solana/
│   │   ├── solana-auction-client.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── unified/
│   │   ├── onchain-auction-client.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── types/
│   │   └── common.ts                 # Shared types
│   └── utils/
│       ├── chain-config.ts
│       └── validation.ts
│
├── test/
│   ├── evm/
│   │   └── AuctionRegistry.test.ts
│   └── unified/
│       └── auction-client.test.ts
│
├── scripts/
│   ├── evm/
│   │   ├── deploy.ts
│   │   └── upgrade.ts
│   └── solana/
│       └── deploy.ts
│
├── hardhat.config.cts
├── Cargo.toml                    # Rust workspace
├── Anchor.toml                   # Solana config
├── package.json
└── tsconfig.*.json               # Multiple TS configs
```

---

## Auction Types Specification

### 1. Traditional Auction

**Parameters:** `startAmount`, `increment`, `reservePrice`, `deadline`

**Flow:**

1. Dealer creates auction, deposits items
2. Bidders place bids >= `currentBid + increment`
3. On new bid: automatic refund to previous bidder (push pattern)
4. After deadline:
   - If `currentBid >= reservePrice`: Anyone calls `finalize()` → items to winner, payment to dealer
   - If `currentBid < reservePrice`: Set 24h acceptance window
5. During 24h window: Dealer can call `acceptBid()` → same as above
6. After 24h without acceptance: `finalize()` → items to dealer, refund to bidder

### 2. Dutch Auction

**Parameters:** `startPrice`, `decreaseAmount`, `decreaseInterval`, `minimumPrice`, `deadline`

**Flow:**

1. Dealer creates auction, deposits items
2. Price decreases: `currentPrice = max(startPrice - (elapsed/interval * decreaseAmount), minimumPrice)`
3. Anyone calls `buy()` at current price → payment to dealer, items to buyer
4. If deadline passes with no buyer: `finalize()` → items returned to dealer

### 3. Penny Auction

**Parameters:** `incrementAmount`, `timerDuration` (5 minutes)

**Flow:**

1. Dealer creates auction, deposits items
2. Each bid = `incrementAmount` paid immediately to dealer (cumulative)
3. Timer resets to 5 minutes on each bid
4. When timer expires: `finalize()` → items to last bidder

---

## EVM Contract Architecture

### Data Structures

```solidity
enum AuctionType { Traditional, Dutch, Penny }
enum AuctionStatus { Active, Expired, Finalized, Refunded }
enum ItemType { ERC20, ERC721, ERC1155 }

struct AuctionItem {
    address tokenAddress;
    ItemType itemType;
    uint256 tokenId;      // 0 for ERC-20
    uint256 amount;       // quantity
}

struct AuctionCore {
    address dealer;
    AuctionType auctionType;
    AuctionStatus status;
    address paymentToken;
    uint96 deadline;
    address highBidder;
    uint128 currentBid;
    uint80 createdAt;
}

// Type-specific params in separate mappings
struct TraditionalParams {
    uint128 startAmount;
    uint128 increment;
    uint128 reservePrice;
    uint96 acceptanceDeadline;
}

struct DutchParams {
    uint128 startPrice;
    uint128 decreaseAmount;
    uint64 decreaseInterval;
    uint128 minimumPrice;
    uint64 startTime;
}

struct PennyParams {
    uint128 incrementAmount;
    uint128 totalPaid;
    uint64 lastBidTime;
    uint64 timerDuration;
}
```

### Main Functions

```solidity
// Creation
function createTraditionalAuction(AuctionItem[] calldata items, address paymentToken, uint128 startAmount, uint128 increment, uint128 reservePrice, uint96 deadline) external returns (uint256 auctionId);
function createDutchAuction(AuctionItem[] calldata items, address paymentToken, uint128 startPrice, uint128 decreaseAmount, uint64 decreaseInterval, uint128 minimumPrice, uint96 deadline) external returns (uint256 auctionId);
function createPennyAuction(AuctionItem[] calldata items, address paymentToken, uint128 incrementAmount) external returns (uint256 auctionId);

// Bidding
function bidTraditional(uint256 auctionId, uint128 amount) external;
function buyDutch(uint256 auctionId) external;
function bidPenny(uint256 auctionId) external;

// Finalization
function finalizeAuction(uint256 auctionId) external;
function dealerAcceptBid(uint256 auctionId) external;

// Admin
function pause() external onlyOwner;
function unpause() external onlyOwner;
function claimFees(address token) external onlyOwner;
```

### Security Measures

- **Reentrancy**: Use OpenZeppelin's `ReentrancyGuard`
- **Token Safety**: Use `SafeERC20` for all transfers
- **CEI Pattern**: Checks-Effects-Interactions throughout
- **Receiver Interfaces**: Implement `IERC721Receiver`, `IERC1155Receiver`
- **Access Control**: 2-step ownership transfer

### Fee Implementation

```solidity
// 0.5% = 50 basis points
uint16 constant FEE_RATE = 50;
uint16 constant FEE_DENOMINATOR = 10000;

function calculateFee(uint256 amount) internal pure returns (uint256 fee, uint256 net) {
    fee = (amount * FEE_RATE) / FEE_DENOMINATOR;
    net = amount - fee;
}
```

---

## Solana Program Architecture

### PDA Structure

```text
Program State: [b"auction_state"]
Auction:       [b"auction", &[1], auction_id]
Escrow:        [b"escrow", &[1], auction_id]
Item Vault:    [b"item_vault", &[1], auction_id, mint]
Fee Vault:     [b"fee_vault", &[1], payment_mint]
```

### Account Structures

```rust
pub struct AuctionProgramState {
    pub owner: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

pub struct Auction {
    pub auction_id: [u8; 32],
    pub dealer: Pubkey,
    pub current_bidder: Pubkey,
    pub payment_mint: Pubkey,
    pub current_bid: u64,
    pub status: AuctionStatus,
    pub auction_type: AuctionType,
    pub item_count: u8,
    pub created_at: i64,
    pub total_payments: u64,
    pub bump: u8,
}

pub enum AuctionType {
    Traditional { start_amount: u64, increment: u64, reserve_price: u64, deadline: i64, acceptance_deadline: i64 },
    Dutch { start_price: u64, decrease_amount: u64, interval: i64, minimum_price: u64, deadline: i64, start_time: i64 },
    Penny { increment: u64, timer_duration: i64, current_deadline: i64 },
}
```

### Instructions

```rust
pub enum AuctionInstruction {
    Initialize,
    SetPaused { paused: bool },
    ClaimFees { payment_mint: Pubkey },

    CreateTraditionalAuction { auction_id: [u8; 32], payment_mint: Pubkey, start_amount: u64, increment: u64, reserve_price: u64, deadline: i64 },
    CreateDutchAuction { auction_id: [u8; 32], payment_mint: Pubkey, start_price: u64, decrease_amount: u64, interval: i64, minimum_price: u64, deadline: i64 },
    CreatePennyAuction { auction_id: [u8; 32], payment_mint: Pubkey, increment: u64, timer_duration: i64 },

    DepositTokens { auction_id: [u8; 32], amount: u64 },
    DepositNft { auction_id: [u8; 32] },

    BidTraditional { auction_id: [u8; 32], amount: u64 },
    BuyDutch { auction_id: [u8; 32], max_price: u64 },
    BidPenny { auction_id: [u8; 32] },

    FinalizeAuction { auction_id: [u8; 32] },
    AcceptBid { auction_id: [u8; 32] },
}
```

---

## TypeScript Client Architecture

### Unified Client Pattern (Stateless)

```typescript
export class OnchainAuctionClient {
    // Lazy-loaded platform clients
    private static evmClient: EVMAuctionClient | null = null;
    private static solanaClient: SolanaAuctionClient | null = null;

    async createTraditionalAuction(
        wallet: Wallet,
        chainInfo: ChainInfo,
        items: AuctionItem[],
        params: TraditionalParams
    ): Promise<{ auctionId: string; txHash: string }>;

    async bid(
        wallet: Wallet,
        chainInfo: ChainInfo,
        auctionId: string,
        amount?: bigint  // Required for Traditional, optional for Penny
    ): Promise<{ txHash: string }>;

    async finalize(
        wallet: Wallet,
        chainInfo: ChainInfo,
        auctionId: string
    ): Promise<{ txHash: string }>;

    // View functions
    async getAuction(chainInfo: ChainInfo, auctionId: string): Promise<Auction>;
    async getDutchCurrentPrice(chainInfo: ChainInfo, auctionId: string): Promise<bigint>;
}
```

### Shared Types

```typescript
enum AuctionType { Traditional = 0, Dutch = 1, Penny = 2 }
enum AuctionStatus { Active = 0, Expired = 1, Finalized = 2, Refunded = 3 }
enum ItemType { ERC20 = 0, ERC721 = 1, ERC1155 = 2 }

interface AuctionItem {
    tokenAddress: string;
    itemType: ItemType;
    tokenId: bigint;
    amount: bigint;
}

interface TraditionalParams {
    startAmount: bigint;
    increment: bigint;
    reservePrice: bigint;
    deadline: number;
}

// Similar for DutchParams, PennyParams
```

---

## Implementation Phases

### Phase 1: Project Setup ✓

1. ✓ Initialize directory structure
2. ✓ Configure Hardhat (Solidity 0.8.24, optimizer)
3. ✓ Configure Cargo workspace for Solana
4. ✓ Set up TypeScript configs (evm, solana, unified, test)
5. ✓ Add dependencies (OpenZeppelin, SPL Token, Borsh)

### Phase 2: EVM Contracts ✓

1. ✓ Implement storage layout (`AuctionRegistryStorage.sol`)
2. ✓ Implement interfaces and types
3. ✓ Implement `TokenTransferLib` and `FeeLib`
4. ✓ Implement `AuctionRegistry` with UUPS proxy
5. ✓ Write comprehensive tests

### Phase 3: Solana Program ✓

1. ✓ Implement state structures with Borsh
2. ✓ Implement instruction parsing
3. ✓ Implement processors for each auction type
4. ✓ Implement CPI helpers for SPL Token
5. ✓ Write tests

### Phase 4: TypeScript Clients ✓

1. ✓ Implement EVM client with Viem
2. ✓ Implement Solana client with @solana/web3.js
3. ✓ Implement unified client with lazy loading
4. ✓ Add validation utilities
5. ✓ Write client tests

### Phase 5: Deployment & Documentation ✓

1. ✓ Create deployment scripts
2. ✓ Add contract verification support
3. ✓ Create usage examples

---

## Deployment Commands

### EVM Deployment

```bash
# Local development
npm run deploy:evm:local

# Sepolia testnet (with verification)
npm run deploy:evm:sepolia -- --verify

# Mainnet
npm run deploy:evm:mainnet -- --verify
```

### Solana Deployment

```bash
# Build program
cargo build-bpf --manifest-path programs/auctions/Cargo.toml

# Deploy to devnet
solana program deploy target/deploy/auctions.so --url devnet

# Initialize program (after deploy)
npx ts-node scripts/solana/deploy.ts --network devnet

# Deploy to mainnet
solana program deploy target/deploy/auctions.so --url mainnet-beta
npx ts-node scripts/solana/deploy.ts --network mainnet-beta
```

### Environment Variables

```bash
# EVM
PRIVATE_KEY=0x...
ALCHEMY_API_KEY=...
ETHERSCAN_API_KEY=...

# Solana
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json
SOLANA_PROGRAM_PATH=target/deploy/auctions.so
```

---

## Usage Examples

See `examples/` directory for comprehensive usage examples:

- `examples/evm-usage.ts` - EVM auction operations
- `examples/solana-usage.ts` - Solana auction operations

---

## Events (EVM)

```solidity
event AuctionCreated(uint256 indexed auctionId, address indexed dealer, AuctionType auctionType, address paymentToken);
event ItemDeposited(uint256 indexed auctionId, address indexed token, ItemType itemType, uint256 tokenId, uint256 amount);
event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint128 amount);
event BidRefunded(uint256 indexed auctionId, address indexed bidder, uint128 amount);
event DutchPurchase(uint256 indexed auctionId, address indexed buyer, uint128 price);
event PennyBidPlaced(uint256 indexed auctionId, address indexed bidder, uint128 incrementPaid, uint64 newDeadline);
event AuctionFinalized(uint256 indexed auctionId, address indexed winner, uint128 finalPrice, uint128 feeAmount);
event DealerAccepted(uint256 indexed auctionId, uint128 acceptedBid);
event AuctionRefunded(uint256 indexed auctionId);
event Paused(address indexed by);
event Unpaused(address indexed by);
```

---

## Testing Strategy

### EVM Tests (Hardhat + Viem)

- Unit tests for each auction type lifecycle
- Edge cases: exact reserve, deadline boundaries
- Fee calculations at various amounts
- Batch item auctions (multiple NFTs)
- Upgrade scenarios
- Reentrancy attack simulations

### Solana Tests (Cargo)

- PDA derivation validation
- All instruction flows
- Clock manipulation for time-based logic
- Token transfer verification

### Integration Tests

- Full auction flows end-to-end
- Cross-client consistency
- Gas/compute unit benchmarks

---

## Reference Files

From `~/0xmail/mail_box_contracts`:

- `contracts/Mailer.sol` - UUPS pattern, storage optimization
- `programs/mailer/src/lib.rs` - Native Solana program structure
- `src/unified/onchain-mailer-client.ts` - Stateless client pattern
- `src/evm/evm-mailer-client.ts` - Viem integration
- `src/solana/solana-mailer-client.ts` - Solana web3.js patterns
