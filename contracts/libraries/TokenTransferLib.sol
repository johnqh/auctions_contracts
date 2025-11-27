// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "../interfaces/IAuctionTypes.sol";

/**
 * @title TokenTransferLib
 * @notice Library for safe token transfers across ERC-20, ERC-721, and ERC-1155
 */
library TokenTransferLib {
    using SafeERC20 for IERC20;

    /**
     * @notice Transfer ERC-20 tokens safely
     * @param token The token contract address
     * @param from The sender address
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function safeTransferERC20(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (from == address(this)) {
            IERC20(token).safeTransfer(to, amount);
        } else {
            IERC20(token).safeTransferFrom(from, to, amount);
        }
    }

    /**
     * @notice Transfer ERC-721 token safely
     * @param token The token contract address
     * @param from The sender address
     * @param to The recipient address
     * @param tokenId The token ID to transfer
     */
    function safeTransferERC721(
        address token,
        address from,
        address to,
        uint256 tokenId
    ) internal {
        IERC721(token).safeTransferFrom(from, to, tokenId);
    }

    /**
     * @notice Transfer ERC-1155 token safely
     * @param token The token contract address
     * @param from The sender address
     * @param to The recipient address
     * @param tokenId The token ID to transfer
     * @param amount The amount to transfer
     */
    function safeTransferERC1155(
        address token,
        address from,
        address to,
        uint256 tokenId,
        uint256 amount
    ) internal {
        IERC1155(token).safeTransferFrom(from, to, tokenId, amount, "");
    }

    /**
     * @notice Transfer an auction item based on its type
     * @param item The auction item to transfer
     * @param from The sender address
     * @param to The recipient address
     */
    function transferItem(
        IAuctionTypes.AuctionItem memory item,
        address from,
        address to
    ) internal {
        if (item.itemType == IAuctionTypes.ItemType.ERC20) {
            safeTransferERC20(item.tokenAddress, from, to, item.amount);
        } else if (item.itemType == IAuctionTypes.ItemType.ERC721) {
            safeTransferERC721(item.tokenAddress, from, to, item.tokenId);
        } else if (item.itemType == IAuctionTypes.ItemType.ERC1155) {
            safeTransferERC1155(item.tokenAddress, from, to, item.tokenId, item.amount);
        }
    }

    /**
     * @notice Transfer multiple auction items
     * @param items Array of auction items to transfer
     * @param from The sender address
     * @param to The recipient address
     */
    function transferItems(
        IAuctionTypes.AuctionItem[] memory items,
        address from,
        address to
    ) internal {
        uint256 length = items.length;
        for (uint256 i = 0; i < length; ) {
            transferItem(items[i], from, to);
            unchecked { ++i; }
        }
    }

    /**
     * @notice Validate that a token address is a contract
     * @param token The token address to validate
     */
    function validateTokenAddress(address token) internal view {
        require(token != address(0), "TokenTransferLib: zero address");
        require(token.code.length > 0, "TokenTransferLib: not a contract");
    }
}
