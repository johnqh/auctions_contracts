// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAuctionTypes
 * @notice Shared types for the auction system
 */
interface IAuctionTypes {
    /// @notice Types of auctions supported
    enum AuctionType {
        Traditional,  // 0 - English auction with reserve price
        Dutch,        // 1 - Descending price auction
        Penny         // 2 - Incremental bid auction with timer reset
    }

    /// @notice Status of an auction
    enum AuctionStatus {
        Active,       // 0 - Auction is live and accepting bids
        Expired,      // 1 - Deadline passed, pending finalization
        Finalized,    // 2 - Successfully completed
        Refunded      // 3 - Items returned to dealer, bidder refunded
    }

    /// @notice Types of tokens that can be auctioned
    enum ItemType {
        ERC20,        // 0 - Fungible tokens
        ERC721,       // 1 - Non-fungible tokens
        ERC1155       // 2 - Semi-fungible tokens
    }

    /// @notice Represents an item in an auction
    /// @dev Supports ERC-20, ERC-721, and ERC-1155 tokens
    struct AuctionItem {
        address tokenAddress;  // Token contract address
        ItemType itemType;     // Type of token
        uint256 tokenId;       // Token ID (0 for ERC-20)
        uint256 amount;        // Quantity (1 for ERC-721)
    }

    /// @notice Core auction data shared across all auction types
    /// @dev Packed for storage efficiency
    struct AuctionCore {
        address dealer;           // Auction creator
        AuctionType auctionType;  // Type of auction
        AuctionStatus status;     // Current status
        address paymentToken;     // ERC-20 token for payments
        uint96 deadline;          // Auction end timestamp
        address highBidder;       // Current highest bidder / buyer
        uint128 currentBid;       // Current bid amount
        uint64 createdAt;         // Creation timestamp
    }

    /// @notice Parameters specific to Traditional auctions
    struct TraditionalParams {
        uint128 startAmount;           // Minimum first bid
        uint128 increment;             // Minimum bid increase
        uint128 reservePrice;          // Minimum price to auto-finalize
        uint96 acceptanceDeadline;     // Dealer acceptance deadline (24h after auction end)
        bool reserveMet;               // Whether reserve price was met
    }

    /// @notice Parameters specific to Dutch auctions
    struct DutchParams {
        uint128 startPrice;       // Initial price
        uint128 decreaseAmount;   // Price decrease per interval
        uint64 decreaseInterval;  // Seconds between decreases
        uint128 minimumPrice;     // Floor price
        uint64 startTime;         // When price starts decreasing
    }

    /// @notice Parameters specific to Penny auctions
    struct PennyParams {
        uint128 incrementAmount;  // Fixed bid increment (paid to dealer)
        uint128 totalPaid;        // Total payments received
        uint64 lastBidTime;       // Timestamp of last bid
        uint64 timerDuration;     // Timer reset duration (5 minutes)
    }
}
