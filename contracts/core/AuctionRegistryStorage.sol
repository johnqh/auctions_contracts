// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IAuctionTypes.sol";

/**
 * @title AuctionRegistryStorage
 * @notice Storage layout for the AuctionRegistry contract
 * @dev This contract defines storage variables for UUPS proxy safety
 */
abstract contract AuctionRegistryStorage is IAuctionTypes {
    // ============ Core Auction Storage ============

    /// @notice Mapping from auction ID to core auction data
    mapping(uint256 => AuctionCore) internal _auctions;

    /// @notice Mapping from auction ID to Traditional auction parameters
    mapping(uint256 => TraditionalParams) internal _traditionalParams;

    /// @notice Mapping from auction ID to Dutch auction parameters
    mapping(uint256 => DutchParams) internal _dutchParams;

    /// @notice Mapping from auction ID to Penny auction parameters
    mapping(uint256 => PennyParams) internal _pennyParams;

    /// @notice Mapping from auction ID to array of items
    mapping(uint256 => AuctionItem[]) internal _auctionItems;

    /// @notice Counter for auction IDs
    uint256 internal _nextAuctionId;

    // ============ Access Control Storage ============

    /// @notice Contract owner
    address internal _owner;

    /// @notice Pending owner for 2-step transfer
    address internal _pendingOwner;

    /// @notice Whether the contract is paused
    bool internal _paused;

    // ============ Fee Storage ============

    /// @notice Fee rate in basis points (50 = 0.5%)
    uint16 internal _feeRate;

    /// @notice Fee recipient address
    address internal _feeRecipient;

    /// @notice Accumulated fees per token
    mapping(address => uint256) internal _accumulatedFees;

    // ============ Reentrancy Guard ============

    /// @notice Reentrancy status
    uint256 internal _reentrancyStatus;

    /// @notice Not entered constant
    uint256 internal constant _NOT_ENTERED = 1;

    /// @notice Entered constant
    uint256 internal constant _ENTERED = 2;

    // ============ Time Constants ============

    /// @notice 24 hours in seconds for dealer acceptance window
    uint256 internal constant ACCEPTANCE_PERIOD = 24 hours;

    /// @notice 5 minutes in seconds for Penny auction timer
    uint64 internal constant PENNY_TIMER_DURATION = 5 minutes;

    // ============ Storage Gap ============

    /// @notice Storage gap for future upgrades
    uint256[50] private __gap;
}
