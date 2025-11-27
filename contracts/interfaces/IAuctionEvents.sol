// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAuctionTypes.sol";

/**
 * @title IAuctionEvents
 * @notice Events emitted by the auction system
 */
interface IAuctionEvents {
    // ============ Auction Lifecycle Events ============

    /// @notice Emitted when a new auction is created
    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed dealer,
        IAuctionTypes.AuctionType auctionType,
        address paymentToken,
        uint96 deadline
    );

    /// @notice Emitted when an item is deposited into an auction
    event ItemDeposited(
        uint256 indexed auctionId,
        address indexed tokenAddress,
        IAuctionTypes.ItemType itemType,
        uint256 tokenId,
        uint256 amount
    );

    // ============ Bidding Events ============

    /// @notice Emitted when a bid is placed on a Traditional auction
    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint128 amount,
        uint128 previousBid
    );

    /// @notice Emitted when a previous bidder is refunded
    event BidRefunded(
        uint256 indexed auctionId,
        address indexed bidder,
        uint128 amount
    );

    /// @notice Emitted when someone purchases in a Dutch auction
    event DutchPurchase(
        uint256 indexed auctionId,
        address indexed buyer,
        uint128 price
    );

    /// @notice Emitted when a bid is placed on a Penny auction
    event PennyBidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint128 incrementPaid,
        uint128 totalPaid,
        uint64 newDeadline
    );

    // ============ Finalization Events ============

    /// @notice Emitted when an auction is successfully finalized
    event AuctionFinalized(
        uint256 indexed auctionId,
        address indexed winner,
        uint128 finalPrice,
        uint128 feeAmount
    );

    /// @notice Emitted when a Traditional auction expires below reserve
    event AuctionExpired(
        uint256 indexed auctionId,
        uint96 acceptanceDeadline
    );

    /// @notice Emitted when dealer accepts a bid below reserve
    event DealerAccepted(
        uint256 indexed auctionId,
        uint128 acceptedBid
    );

    /// @notice Emitted when an auction is refunded (items to dealer, payment to bidder)
    event AuctionRefunded(
        uint256 indexed auctionId,
        address indexed dealer,
        address indexed bidder
    );

    // ============ Admin Events ============

    /// @notice Emitted when the contract is paused
    event Paused(address indexed by);

    /// @notice Emitted when the contract is unpaused
    event Unpaused(address indexed by);

    /// @notice Emitted when the fee rate is updated
    event FeeRateUpdated(uint16 oldRate, uint16 newRate);

    /// @notice Emitted when the fee recipient is updated
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /// @notice Emitted when fees are claimed
    event FeesClaimed(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when ownership is transferred
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when ownership transfer is accepted
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
}
