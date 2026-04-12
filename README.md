# @sudobility/auctions_contracts

Multi-chain auction system supporting Solana (Rust/Anchor) and EVM (Solidity/Hardhat). Implements Traditional, Dutch, and Penny auction types.

## Installation

```bash
bun install
```

## Usage

The package provides a TypeScript SDK with four export points:

```typescript
import { OnchainAuctionClient } from '@sudobility/auctions_contracts';          // Unified client
import { EvmAuctionClient } from '@sudobility/auctions_contracts/evm';          // EVM-specific (viem)
import { SolanaAuctionClient } from '@sudobility/auctions_contracts/solana';    // Solana-specific (web3.js)
import { ... } from '@sudobility/auctions_contracts/react-native';              // React Native entry
```

### Auction Types

- **Traditional**: English-style ascending bids with reserve price and minimum increment
- **Dutch**: Descending price from start to minimum; first buyer wins immediately
- **Penny**: Fixed bid increment (pay-to-bid); each bid resets a 5-minute timer

### Supported Networks

- **EVM**: Ethereum, Sepolia, Polygon, Optimism, Base, Arbitrum
- **Solana**: Localnet, Devnet, Mainnet-beta

## Development

```bash
bun run build              # Build everything (EVM + Solana + Unified + React Native)
bun run build:ci           # Build unified + react-native only (no EVM/Solana compile)
bun run compile:evm        # Compile Solidity contracts only
bun run test               # Run EVM tests (Hardhat + viem)
bun run test:solana        # Run Solana tests (cargo test)
bun run test:ci            # Build unified then run unified tests directly
bun run lint               # ESLint check
bun run lint:fix           # ESLint with auto-fix
bun run typecheck          # TypeScript compilation check
bun run format             # Prettier formatting
bun run clean              # Hardhat clean
```

### Deployment

```bash
bun run deploy:evm:local       # Deploy to Hardhat localhost
bun run deploy:evm:sepolia     # Deploy to Sepolia
bun run deploy:solana:devnet   # Deploy to Solana devnet
```

## Architecture

### EVM (Solidity 0.8.24)

- UUPS Upgradeable Proxy pattern
- Storage gap (`__gap`) for future slot reservation
- CEI pattern, SafeERC20, reentrancy guards

### Solana (Rust/Anchor 0.28.0)

- PDA-based accounting with deterministic address derivation
- Borsh serialization, saturating arithmetic

### Unified Client

The `OnchainAuctionClient` uses dynamic `import()` to lazy-load platform-specific clients (EVM or Solana) on first use, keeping bundle size minimal.

## Key Constants

| Constant              | Value                   |
| --------------------- | ----------------------- |
| Fee Rate              | 0.5% (50 basis points)  |
| Max Fee Rate          | 10% (1000 basis points) |
| Acceptance Period     | 24 hours                |
| Penny Timer           | 5 minutes               |
| Max Items Per Auction | 255                     |

## License

BUSL-1.1
