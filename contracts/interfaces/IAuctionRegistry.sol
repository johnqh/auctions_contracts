// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAuctionTypes.sol";

/**
 * @title IAuctionRegistry
 * @notice Interface for the main auction registry contract
 */
interface IAuctionRegistry is IAuctionTypes {
    // ============ Auction Creation ============

    /**
     * @notice Create a Traditional auction
     * @param items Array of items to auction
     * @param paymentToken ERC-20 token for payments
     * @param startAmount Minimum first bid
     * @param increment Minimum bid increase
     * @param reservePrice Minimum price to auto-finalize
     * @param deadline Auction end timestamp
     * @return auctionId The ID of the created auction
     */
    function createTraditionalAuction(
        AuctionItem[] calldata items,
        address paymentToken,
        uint128 startAmount,
        uint128 increment,
        uint128 reservePrice,
        uint96 deadline
    ) external returns (uint256 auctionId);

    /**
     * @notice Create a Dutch auction
     * @param items Array of items to auction
     * @param paymentToken ERC-20 token for payments
     * @param startPrice Initial price
     * @param decreaseAmount Price decrease per interval
     * @param decreaseInterval Seconds between decreases
     * @param minimumPrice Floor price
     * @param deadline Auction end timestamp
     * @return auctionId The ID of the created auction
     */
    function createDutchAuction(
        AuctionItem[] calldata items,
        address paymentToken,
        uint128 startPrice,
        uint128 decreaseAmount,
        uint64 decreaseInterval,
        uint128 minimumPrice,
        uint96 deadline
    ) external returns (uint256 auctionId);

    /**
     * @notice Create a Penny auction
     * @param items Array of items to auction
     * @param paymentToken ERC-20 token for payments
     * @param incrementAmount Fixed bid increment amount
     * @return auctionId The ID of the created auction
     */
    function createPennyAuction(
        AuctionItem[] calldata items,
        address paymentToken,
        uint128 incrementAmount
    ) external returns (uint256 auctionId);

    // ============ Bidding ============

    /**
     * @notice Place a bid on a Traditional auction
     * @param auctionId The auction ID
     * @param amount The bid amount
     */
    function bidTraditional(uint256 auctionId, uint128 amount) external;

    /**
     * @notice Buy at current price in a Dutch auction
     * @param auctionId The auction ID
     */
    function buyDutch(uint256 auctionId) external;

    /**
     * @notice Place a bid on a Penny auction
     * @param auctionId The auction ID
     */
    function bidPenny(uint256 auctionId) external;

    // ============ Finalization ============

    /**
     * @notice Finalize an auction
     * @dev Can be called by anyone when conditions are met
     * @param auctionId The auction ID
     */
    function finalizeAuction(uint256 auctionId) external;

    /**
     * @notice Dealer accepts bid below reserve price (Traditional only)
     * @param auctionId The auction ID
     */
    function dealerAcceptBid(uint256 auctionId) external;

    // ============ View Functions ============

    /**
     * @notice Get auction core data and items
     * @param auctionId The auction ID
     * @return core The core auction data
     * @return items The auction items
     */
    function getAuction(uint256 auctionId)
        external
        view
        returns (AuctionCore memory core, AuctionItem[] memory items);

    /**
     * @notice Get Traditional auction parameters
     * @param auctionId The auction ID
     * @return params The Traditional auction parameters
     */
    function getTraditionalParams(uint256 auctionId)
        external
        view
        returns (TraditionalParams memory params);

    /**
     * @notice Get Dutch auction parameters
     * @param auctionId The auction ID
     * @return params The Dutch auction parameters
     */
    function getDutchParams(uint256 auctionId)
        external
        view
        returns (DutchParams memory params);

    /**
     * @notice Get current price for a Dutch auction
     * @param auctionId The auction ID
     * @return currentPrice The current price
     */
    function getDutchCurrentPrice(uint256 auctionId)
        external
        view
        returns (uint128 currentPrice);

    /**
     * @notice Get Penny auction parameters
     * @param auctionId The auction ID
     * @return params The Penny auction parameters
     */
    function getPennyParams(uint256 auctionId)
        external
        view
        returns (PennyParams memory params);

    /**
     * @notice Get effective deadline for a Penny auction
     * @param auctionId The auction ID
     * @return effectiveDeadline The effective deadline (lastBidTime + timerDuration)
     */
    function getPennyDeadline(uint256 auctionId)
        external
        view
        returns (uint256 effectiveDeadline);

    /**
     * @notice Get the next auction ID
     * @return The next auction ID that will be assigned
     */
    function nextAuctionId() external view returns (uint256);

    /**
     * @notice Check if the contract is paused
     * @return True if paused
     */
    function paused() external view returns (bool);

    /**
     * @notice Get the fee rate in basis points
     * @return The fee rate (50 = 0.5%)
     */
    function feeRate() external view returns (uint16);

    /**
     * @notice Get accumulated fees for a token
     * @param token The token address
     * @return The accumulated fee amount
     */
    function accumulatedFees(address token) external view returns (uint256);

    // ============ Admin Functions ============

    /**
     * @notice Pause the contract
     */
    function pause() external;

    /**
     * @notice Unpause the contract
     */
    function unpause() external;

    /**
     * @notice Set the fee rate
     * @param newRate New fee rate in basis points (max 1000 = 10%)
     */
    function setFeeRate(uint16 newRate) external;

    /**
     * @notice Set the fee recipient
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external;

    /**
     * @notice Claim accumulated fees for a token
     * @param token The token address to claim fees for
     */
    function claimFees(address token) external;

    /**
     * @notice Start ownership transfer
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external;

    /**
     * @notice Accept ownership transfer
     */
    function acceptOwnership() external;
}
