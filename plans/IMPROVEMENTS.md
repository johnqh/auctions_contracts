# Improvement Plans for @sudobility/auctions_contracts

## Priority 1 - High Impact

### 1. Expand Test Coverage for Solana Program and Unified Client

- The `test/` directory contains `test/evm/AuctionRegistry.test.ts` and `test/unified/onchain-auction-client.test.ts`, but there are no TypeScript-level tests for the Solana client (`src/solana/`). The Solana Rust program is tested via `cargo test`, but the TypeScript SDK wrapper that consumers use directly needs its own test suite.
- The unified client test (`onchain-auction-client.test.ts`) should cover the lazy-loading behavior: verifying that importing the unified client does not eagerly load EVM or Solana dependencies, and that the correct platform client is loaded based on chain type.
- Edge case testing is needed for: Dutch auction price floor calculations at boundary conditions, Penny auction timer expiry at exactly the deadline, Traditional auction acceptance period transitions, and fee calculation precision at extreme values.

### 2. Add Comprehensive JSDoc to TypeScript SDK

- `src/types/common.ts` exports 15+ interfaces, 4 enums, and 15+ utility functions that form the public API. Currently only minimal type annotations exist with no JSDoc comments explaining constraints, units (e.g., bigint values are in wei/lamports), or valid ranges.
- Utility functions like `calculateFee()`, `calculateDutchPrice()`, `validateTraditionalParams()`, and `validateDutchParams()` need JSDoc with `@param` documentation specifying units, `@returns` documenting precision, and `@throws` listing validation error conditions.
- `PROTOCOL_CONSTANTS` should have JSDoc documenting the source of each constant (e.g., `FEE_RATE: 50` is 0.5% in basis points, matching the Solidity `FeeLib.sol`).

### 3. Add Security Audit Checklist and Invariant Documentation

- The Solidity contracts use UUPS upgradeable proxy, reentrancy guards, SafeERC20, and CEI pattern, but there is no documented security audit checklist or invariant list. Documenting the security assumptions (e.g., "fee rate cannot exceed 10%", "only dealer can finalize", "escrow funds are always recoverable") would prepare the contracts for formal audit.
- The Solana program's `processor.rs` (~1813 lines) contains 15 handlers with complex state transitions. Documenting the state machine (which transitions are valid from each `AuctionStatus`) would help reviewers verify correctness.
- The `__gap` storage pattern in `AuctionRegistryStorage.sol` (50 slots) needs documentation explaining the upgrade strategy and how many slots have been consumed.

## Priority 2 - Medium Impact

### 4. Complete React Native Entry Point

- `src/react-native/` is listed as a build target and export path in `package.json` (`@sudobility/auctions_contracts/react-native`) but the CLAUDE.md notes "directory does not exist yet". Creating the React Native entry point, even as a re-export of the unified client with RN-specific polyfill documentation, would prevent consumers from hitting import errors.

### 5. Improve Error Handling in TypeScript SDK

- Validation functions (`validateTraditionalParams`, `validateDutchParams`, `validatePennyParams`, `validateTraditionalBid`) return `ValidationResult` objects, but transaction methods in the EVM and Solana clients may throw untyped errors from the underlying providers (viem, web3.js). Wrapping these in typed error classes (e.g., `AuctionContractError` with `code`, `reason`, `txHash`) would improve consumer error handling.
- The unified client's lazy-loading uses dynamic `import()` which can fail at runtime if the platform package is not installed. Adding clear error messages when a platform dependency is missing (e.g., "viem is required for EVM auctions") would improve DX.

### 6. Add Deployment Verification Scripts

- Deployment scripts exist (`deploy:evm:local`, `deploy:evm:sepolia`, `deploy:solana:devnet`) but there are no post-deployment verification scripts that check the deployed contract state matches expectations (correct owner, correct fee rate, correct upgrade authority).
- Adding a `verify:evm` script that reads on-chain state and compares against expected values would catch deployment issues early.

## Priority 3 - Nice to Have

### 7. Add Gas/Compute Budget Benchmarks

- EVM tests run on Hardhat but do not report gas usage for common operations (create auction, place bid, finalize). Adding gas snapshots to the test suite would catch gas regressions and help estimate deployment costs.
- Solana program compute budget usage for each instruction is not documented. Adding compute unit logging to the Rust tests would help operators set appropriate compute budget limits.

### 8. Unify Build Configuration

- Five separate `tsconfig.*.json` files (base, evm, solana, unified, react-native) plus `tsconfig.test.json` create maintenance overhead. Investigating whether tsconfig project references or a single config with path-based exclusions could simplify the build setup would reduce configuration drift.

### 9. Add Integration Test Against Testnet

- All tests currently run against local environments (Hardhat, Solana localnet). Adding an optional CI step that deploys to a testnet and runs a smoke test would catch issues that only appear in real network conditions (block confirmation times, gas price fluctuations, RPC rate limits).
