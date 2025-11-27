// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./AuctionRegistryStorage.sol";
import "../interfaces/IAuctionRegistry.sol";
import "../interfaces/IAuctionEvents.sol";
import "../libraries/FeeLib.sol";
import "../libraries/TokenTransferLib.sol";

/**
 * @title AuctionRegistry
 * @notice Main registry contract for multi-type auctions
 * @dev Supports Traditional, Dutch, and Penny auctions with ERC-20/721/1155 items
 */
contract AuctionRegistry is
    Initializable,
    UUPSUpgradeable,
    AuctionRegistryStorage,
    IAuctionRegistry,
    IAuctionEvents,
    IERC721Receiver,
    IERC1155Receiver
{
    using SafeERC20 for IERC20;
    using FeeLib for uint256;
    using TokenTransferLib for AuctionItem;
    using TokenTransferLib for AuctionItem[];

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == _owner, "AuctionRegistry: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!_paused, "AuctionRegistry: paused");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "AuctionRegistry: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    modifier auctionExists(uint256 auctionId) {
        require(_auctions[auctionId].dealer != address(0), "AuctionRegistry: auction not found");
        _;
    }

    modifier onlyDealer(uint256 auctionId) {
        require(msg.sender == _auctions[auctionId].dealer, "AuctionRegistry: not dealer");
        _;
    }

    // ============ Constructor & Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param owner_ Initial owner address
     * @param feeRecipient_ Fee recipient address
     * @param feeRate_ Initial fee rate in basis points
     */
    function initialize(
        address owner_,
        address feeRecipient_,
        uint16 feeRate_
    ) external initializer {
        __UUPSUpgradeable_init();

        require(owner_ != address(0), "AuctionRegistry: zero owner");
        require(feeRecipient_ != address(0), "AuctionRegistry: zero fee recipient");
        FeeLib.validateFeeRate(feeRate_);

        _owner = owner_;
        _feeRecipient = feeRecipient_;
        _feeRate = feeRate_;
        _reentrancyStatus = _NOT_ENTERED;
        _nextAuctionId = 1;
    }

    // ============ Auction Creation ============

    /// @inheritdoc IAuctionRegistry
    function createTraditionalAuction(
        AuctionItem[] calldata items,
        address paymentToken,
        uint128 startAmount,
        uint128 increment,
        uint128 reservePrice,
        uint96 deadline
    ) external whenNotPaused nonReentrant returns (uint256 auctionId) {
        require(items.length > 0, "AuctionRegistry: no items");
        require(paymentToken != address(0), "AuctionRegistry: zero payment token");
        require(deadline > block.timestamp, "AuctionRegistry: deadline in past");
        require(increment > 0, "AuctionRegistry: zero increment");

        auctionId = _nextAuctionId++;

        // Store core data
        _auctions[auctionId] = AuctionCore({
            dealer: msg.sender,
            auctionType: AuctionType.Traditional,
            status: AuctionStatus.Active,
            paymentToken: paymentToken,
            deadline: deadline,
            highBidder: address(0),
            currentBid: 0,
            createdAt: uint64(block.timestamp)
        });

        // Store Traditional params
        _traditionalParams[auctionId] = TraditionalParams({
            startAmount: startAmount,
            increment: increment,
            reservePrice: reservePrice,
            acceptanceDeadline: 0,
            reserveMet: false
        });

        // Transfer items from dealer to contract
        _depositItems(auctionId, items, msg.sender);

        emit AuctionCreated(auctionId, msg.sender, AuctionType.Traditional, paymentToken, deadline);
    }

    /// @inheritdoc IAuctionRegistry
    function createDutchAuction(
        AuctionItem[] calldata items,
        address paymentToken,
        uint128 startPrice,
        uint128 decreaseAmount,
        uint64 decreaseInterval,
        uint128 minimumPrice,
        uint96 deadline
    ) external whenNotPaused nonReentrant returns (uint256 auctionId) {
        require(items.length > 0, "AuctionRegistry: no items");
        require(paymentToken != address(0), "AuctionRegistry: zero payment token");
        require(deadline > block.timestamp, "AuctionRegistry: deadline in past");
        require(startPrice > minimumPrice, "AuctionRegistry: start <= minimum");
        require(decreaseAmount > 0, "AuctionRegistry: zero decrease");
        require(decreaseInterval > 0, "AuctionRegistry: zero interval");

        auctionId = _nextAuctionId++;

        // Store core data
        _auctions[auctionId] = AuctionCore({
            dealer: msg.sender,
            auctionType: AuctionType.Dutch,
            status: AuctionStatus.Active,
            paymentToken: paymentToken,
            deadline: deadline,
            highBidder: address(0),
            currentBid: 0,
            createdAt: uint64(block.timestamp)
        });

        // Store Dutch params
        _dutchParams[auctionId] = DutchParams({
            startPrice: startPrice,
            decreaseAmount: decreaseAmount,
            decreaseInterval: decreaseInterval,
            minimumPrice: minimumPrice,
            startTime: uint64(block.timestamp)
        });

        // Transfer items from dealer to contract
        _depositItems(auctionId, items, msg.sender);

        emit AuctionCreated(auctionId, msg.sender, AuctionType.Dutch, paymentToken, deadline);
    }

    /// @inheritdoc IAuctionRegistry
    function createPennyAuction(
        AuctionItem[] calldata items,
        address paymentToken,
        uint128 incrementAmount
    ) external whenNotPaused nonReentrant returns (uint256 auctionId) {
        require(items.length > 0, "AuctionRegistry: no items");
        require(paymentToken != address(0), "AuctionRegistry: zero payment token");
        require(incrementAmount > 0, "AuctionRegistry: zero increment");

        auctionId = _nextAuctionId++;

        // Initial deadline is 5 minutes from now
        uint64 initialDeadline = uint64(block.timestamp) + PENNY_TIMER_DURATION;

        // Store core data
        _auctions[auctionId] = AuctionCore({
            dealer: msg.sender,
            auctionType: AuctionType.Penny,
            status: AuctionStatus.Active,
            paymentToken: paymentToken,
            deadline: uint96(initialDeadline),
            highBidder: address(0),
            currentBid: 0,
            createdAt: uint64(block.timestamp)
        });

        // Store Penny params
        _pennyParams[auctionId] = PennyParams({
            incrementAmount: incrementAmount,
            totalPaid: 0,
            lastBidTime: 0,
            timerDuration: PENNY_TIMER_DURATION
        });

        // Transfer items from dealer to contract
        _depositItems(auctionId, items, msg.sender);

        emit AuctionCreated(auctionId, msg.sender, AuctionType.Penny, paymentToken, uint96(initialDeadline));
    }

    // ============ Bidding Functions ============

    /// @inheritdoc IAuctionRegistry
    function bidTraditional(
        uint256 auctionId,
        uint128 amount
    ) external whenNotPaused nonReentrant auctionExists(auctionId) {
        AuctionCore storage auction = _auctions[auctionId];
        TraditionalParams storage params = _traditionalParams[auctionId];

        require(auction.auctionType == AuctionType.Traditional, "AuctionRegistry: not traditional");
        require(auction.status == AuctionStatus.Active, "AuctionRegistry: not active");
        require(block.timestamp <= auction.deadline, "AuctionRegistry: deadline passed");

        // Validate bid amount
        uint128 minBid = auction.currentBid == 0
            ? params.startAmount
            : auction.currentBid + params.increment;
        require(amount >= minBid, "AuctionRegistry: bid too low");

        // Store previous bidder for refund
        address previousBidder = auction.highBidder;
        uint128 previousBid = auction.currentBid;

        // Update auction state BEFORE external calls (CEI pattern)
        auction.highBidder = msg.sender;
        auction.currentBid = amount;

        // Check if reserve is met
        if (amount >= params.reservePrice) {
            params.reserveMet = true;
        }

        // Transfer new bid from bidder to contract
        IERC20(auction.paymentToken).safeTransferFrom(msg.sender, address(this), amount);

        // Refund previous bidder (push pattern)
        if (previousBidder != address(0) && previousBid > 0) {
            IERC20(auction.paymentToken).safeTransfer(previousBidder, previousBid);
            emit BidRefunded(auctionId, previousBidder, previousBid);
        }

        emit BidPlaced(auctionId, msg.sender, amount, previousBid);
    }

    /// @inheritdoc IAuctionRegistry
    function buyDutch(
        uint256 auctionId
    ) external whenNotPaused nonReentrant auctionExists(auctionId) {
        AuctionCore storage auction = _auctions[auctionId];
        DutchParams storage params = _dutchParams[auctionId];

        require(auction.auctionType == AuctionType.Dutch, "AuctionRegistry: not dutch");
        require(auction.status == AuctionStatus.Active, "AuctionRegistry: not active");
        require(block.timestamp <= auction.deadline, "AuctionRegistry: deadline passed");

        // Calculate current price
        uint128 currentPrice = _calculateDutchPrice(params);
        require(currentPrice >= params.minimumPrice, "AuctionRegistry: below minimum");

        // Update state BEFORE external calls
        auction.status = AuctionStatus.Finalized;
        auction.highBidder = msg.sender;
        auction.currentBid = currentPrice;

        // Calculate fee
        (uint256 fee, uint256 netAmount) = uint256(currentPrice).calculateFee(_feeRate);
        _accumulatedFees[auction.paymentToken] += fee;

        // Transfer payment from buyer
        IERC20(auction.paymentToken).safeTransferFrom(msg.sender, address(this), currentPrice);

        // Transfer net amount to dealer
        IERC20(auction.paymentToken).safeTransfer(auction.dealer, netAmount);

        // Transfer items to buyer
        _auctionItems[auctionId].transferItems(address(this), msg.sender);

        emit DutchPurchase(auctionId, msg.sender, currentPrice);
        emit AuctionFinalized(auctionId, msg.sender, currentPrice, uint128(fee));
    }

    /// @inheritdoc IAuctionRegistry
    function bidPenny(
        uint256 auctionId
    ) external whenNotPaused nonReentrant auctionExists(auctionId) {
        AuctionCore storage auction = _auctions[auctionId];
        PennyParams storage params = _pennyParams[auctionId];

        require(auction.auctionType == AuctionType.Penny, "AuctionRegistry: not penny");
        require(auction.status == AuctionStatus.Active, "AuctionRegistry: not active");

        // Check if timer has expired
        uint64 effectiveDeadline = params.lastBidTime == 0
            ? uint64(auction.deadline)
            : params.lastBidTime + params.timerDuration;
        require(block.timestamp <= effectiveDeadline, "AuctionRegistry: timer expired");

        uint128 bidAmount = params.incrementAmount;

        // Update state BEFORE external calls
        auction.highBidder = msg.sender;
        auction.currentBid += bidAmount;
        params.totalPaid += bidAmount;
        params.lastBidTime = uint64(block.timestamp);

        // Calculate fee
        (uint256 fee, uint256 netAmount) = uint256(bidAmount).calculateFee(_feeRate);
        _accumulatedFees[auction.paymentToken] += fee;

        // Transfer bid from bidder
        IERC20(auction.paymentToken).safeTransferFrom(msg.sender, address(this), bidAmount);

        // Immediately transfer net amount to dealer (cumulative)
        IERC20(auction.paymentToken).safeTransfer(auction.dealer, netAmount);

        uint64 newDeadline = uint64(block.timestamp) + params.timerDuration;
        emit PennyBidPlaced(auctionId, msg.sender, bidAmount, params.totalPaid, newDeadline);
    }

    // ============ Finalization Functions ============

    /// @inheritdoc IAuctionRegistry
    function finalizeAuction(
        uint256 auctionId
    ) external nonReentrant auctionExists(auctionId) {
        AuctionCore storage auction = _auctions[auctionId];

        if (auction.auctionType == AuctionType.Traditional) {
            _finalizeTraditional(auctionId);
        } else if (auction.auctionType == AuctionType.Dutch) {
            _finalizeDutch(auctionId);
        } else if (auction.auctionType == AuctionType.Penny) {
            _finalizePenny(auctionId);
        }
    }

    /// @inheritdoc IAuctionRegistry
    function dealerAcceptBid(
        uint256 auctionId
    ) external nonReentrant auctionExists(auctionId) onlyDealer(auctionId) {
        AuctionCore storage auction = _auctions[auctionId];
        TraditionalParams storage params = _traditionalParams[auctionId];

        require(auction.auctionType == AuctionType.Traditional, "AuctionRegistry: not traditional");
        require(auction.status == AuctionStatus.Expired, "AuctionRegistry: not expired");
        require(block.timestamp <= params.acceptanceDeadline, "AuctionRegistry: acceptance period ended");
        require(auction.highBidder != address(0), "AuctionRegistry: no bidder");

        // Update status
        auction.status = AuctionStatus.Finalized;

        // Calculate fee
        (uint256 fee, uint256 netAmount) = uint256(auction.currentBid).calculateFee(_feeRate);
        _accumulatedFees[auction.paymentToken] += fee;

        // Transfer payment to dealer (bid is already in contract)
        IERC20(auction.paymentToken).safeTransfer(auction.dealer, netAmount);

        // Transfer items to winner
        _auctionItems[auctionId].transferItems(address(this), auction.highBidder);

        emit DealerAccepted(auctionId, auction.currentBid);
        emit AuctionFinalized(auctionId, auction.highBidder, auction.currentBid, uint128(fee));
    }

    // ============ Internal Finalization ============

    function _finalizeTraditional(uint256 auctionId) internal {
        AuctionCore storage auction = _auctions[auctionId];
        TraditionalParams storage params = _traditionalParams[auctionId];

        require(auction.status == AuctionStatus.Active || auction.status == AuctionStatus.Expired,
            "AuctionRegistry: invalid status");

        // If still active, check deadline
        if (auction.status == AuctionStatus.Active) {
            require(block.timestamp > auction.deadline, "AuctionRegistry: not ended");

            // Check if reserve was met
            if (params.reserveMet && auction.highBidder != address(0)) {
                // Reserve met - finalize immediately
                auction.status = AuctionStatus.Finalized;

                (uint256 fee, uint256 netAmount) = uint256(auction.currentBid).calculateFee(_feeRate);
                _accumulatedFees[auction.paymentToken] += fee;

                IERC20(auction.paymentToken).safeTransfer(auction.dealer, netAmount);
                _auctionItems[auctionId].transferItems(address(this), auction.highBidder);

                emit AuctionFinalized(auctionId, auction.highBidder, auction.currentBid, uint128(fee));
            } else if (auction.highBidder != address(0)) {
                // Has bidder but reserve not met - start acceptance period
                auction.status = AuctionStatus.Expired;
                params.acceptanceDeadline = uint96(block.timestamp + ACCEPTANCE_PERIOD);

                emit AuctionExpired(auctionId, params.acceptanceDeadline);
            } else {
                // No bidder - return items to dealer
                auction.status = AuctionStatus.Refunded;
                _auctionItems[auctionId].transferItems(address(this), auction.dealer);

                emit AuctionRefunded(auctionId, auction.dealer, address(0));
            }
        } else {
            // Already expired - check acceptance deadline
            require(block.timestamp > params.acceptanceDeadline, "AuctionRegistry: acceptance period active");

            // Dealer didn't accept - refund
            auction.status = AuctionStatus.Refunded;

            // Refund bidder
            if (auction.highBidder != address(0) && auction.currentBid > 0) {
                IERC20(auction.paymentToken).safeTransfer(auction.highBidder, auction.currentBid);
            }

            // Return items to dealer
            _auctionItems[auctionId].transferItems(address(this), auction.dealer);

            emit AuctionRefunded(auctionId, auction.dealer, auction.highBidder);
        }
    }

    function _finalizeDutch(uint256 auctionId) internal {
        AuctionCore storage auction = _auctions[auctionId];

        require(auction.status == AuctionStatus.Active, "AuctionRegistry: not active");
        require(block.timestamp > auction.deadline, "AuctionRegistry: not ended");

        // No buyer - return items to dealer
        auction.status = AuctionStatus.Refunded;
        _auctionItems[auctionId].transferItems(address(this), auction.dealer);

        emit AuctionRefunded(auctionId, auction.dealer, address(0));
    }

    function _finalizePenny(uint256 auctionId) internal {
        AuctionCore storage auction = _auctions[auctionId];
        PennyParams storage params = _pennyParams[auctionId];

        require(auction.status == AuctionStatus.Active, "AuctionRegistry: not active");

        // Check timer expired
        uint64 effectiveDeadline = params.lastBidTime == 0
            ? uint64(auction.deadline)
            : params.lastBidTime + params.timerDuration;
        require(block.timestamp > effectiveDeadline, "AuctionRegistry: timer not expired");

        if (auction.highBidder != address(0)) {
            // Has winner - transfer items
            auction.status = AuctionStatus.Finalized;
            _auctionItems[auctionId].transferItems(address(this), auction.highBidder);

            // Note: payments already sent to dealer during bidding
            emit AuctionFinalized(auctionId, auction.highBidder, uint128(params.totalPaid), 0);
        } else {
            // No bidder - return items
            auction.status = AuctionStatus.Refunded;
            _auctionItems[auctionId].transferItems(address(this), auction.dealer);

            emit AuctionRefunded(auctionId, auction.dealer, address(0));
        }
    }

    // ============ Internal Helpers ============

    function _depositItems(
        uint256 auctionId,
        AuctionItem[] calldata items,
        address from
    ) internal {
        uint256 length = items.length;
        for (uint256 i = 0; i < length; ) {
            AuctionItem calldata item = items[i];
            TokenTransferLib.validateTokenAddress(item.tokenAddress);

            // Store item
            _auctionItems[auctionId].push(item);

            // Transfer item to contract
            item.transferItem(from, address(this));

            emit ItemDeposited(auctionId, item.tokenAddress, item.itemType, item.tokenId, item.amount);

            unchecked { ++i; }
        }
    }

    function _calculateDutchPrice(DutchParams storage params) internal view returns (uint128) {
        if (block.timestamp <= params.startTime) {
            return params.startPrice;
        }

        uint256 elapsed = block.timestamp - params.startTime;
        uint256 intervals = elapsed / params.decreaseInterval;
        uint256 totalDecrease = intervals * params.decreaseAmount;

        if (totalDecrease >= params.startPrice) {
            return params.minimumPrice;
        }

        uint128 currentPrice = params.startPrice - uint128(totalDecrease);
        return currentPrice < params.minimumPrice ? params.minimumPrice : currentPrice;
    }

    // ============ View Functions ============

    /// @inheritdoc IAuctionRegistry
    function getAuction(uint256 auctionId)
        external
        view
        returns (AuctionCore memory core, AuctionItem[] memory items)
    {
        core = _auctions[auctionId];
        items = _auctionItems[auctionId];
    }

    /// @inheritdoc IAuctionRegistry
    function getTraditionalParams(uint256 auctionId)
        external
        view
        returns (TraditionalParams memory params)
    {
        params = _traditionalParams[auctionId];
    }

    /// @inheritdoc IAuctionRegistry
    function getDutchParams(uint256 auctionId)
        external
        view
        returns (DutchParams memory params)
    {
        params = _dutchParams[auctionId];
    }

    /// @inheritdoc IAuctionRegistry
    function getDutchCurrentPrice(uint256 auctionId)
        external
        view
        returns (uint128 currentPrice)
    {
        currentPrice = _calculateDutchPrice(_dutchParams[auctionId]);
    }

    /// @inheritdoc IAuctionRegistry
    function getPennyParams(uint256 auctionId)
        external
        view
        returns (PennyParams memory params)
    {
        params = _pennyParams[auctionId];
    }

    /// @inheritdoc IAuctionRegistry
    function getPennyDeadline(uint256 auctionId)
        external
        view
        returns (uint256 effectiveDeadline)
    {
        PennyParams storage params = _pennyParams[auctionId];
        effectiveDeadline = params.lastBidTime == 0
            ? _auctions[auctionId].deadline
            : params.lastBidTime + params.timerDuration;
    }

    /// @inheritdoc IAuctionRegistry
    function nextAuctionId() external view returns (uint256) {
        return _nextAuctionId;
    }

    /// @inheritdoc IAuctionRegistry
    function paused() external view returns (bool) {
        return _paused;
    }

    /// @inheritdoc IAuctionRegistry
    function feeRate() external view returns (uint16) {
        return _feeRate;
    }

    /// @inheritdoc IAuctionRegistry
    function accumulatedFees(address token) external view returns (uint256) {
        return _accumulatedFees[token];
    }

    // ============ Admin Functions ============

    /// @inheritdoc IAuctionRegistry
    function pause() external onlyOwner {
        _paused = true;
        emit Paused(msg.sender);
    }

    /// @inheritdoc IAuctionRegistry
    function unpause() external onlyOwner {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    /// @inheritdoc IAuctionRegistry
    function setFeeRate(uint16 newRate) external onlyOwner {
        FeeLib.validateFeeRate(newRate);
        uint16 oldRate = _feeRate;
        _feeRate = newRate;
        emit FeeRateUpdated(oldRate, newRate);
    }

    /// @inheritdoc IAuctionRegistry
    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "AuctionRegistry: zero address");
        address oldRecipient = _feeRecipient;
        _feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /// @inheritdoc IAuctionRegistry
    function claimFees(address token) external onlyOwner {
        uint256 amount = _accumulatedFees[token];
        require(amount > 0, "AuctionRegistry: no fees");

        _accumulatedFees[token] = 0;
        IERC20(token).safeTransfer(_feeRecipient, amount);

        emit FeesClaimed(token, _feeRecipient, amount);
    }

    /// @inheritdoc IAuctionRegistry
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AuctionRegistry: zero address");
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(_owner, newOwner);
    }

    /// @inheritdoc IAuctionRegistry
    function acceptOwnership() external {
        require(msg.sender == _pendingOwner, "AuctionRegistry: not pending owner");
        address oldOwner = _owner;
        _owner = _pendingOwner;
        _pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, _owner);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============ Token Receivers ============

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
