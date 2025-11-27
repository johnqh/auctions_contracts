// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FeeLib
 * @notice Library for fee calculations
 */
library FeeLib {
    /// @notice Maximum fee rate (10%)
    uint16 internal constant MAX_FEE_RATE = 1000;

    /// @notice Fee denominator (basis points)
    uint16 internal constant FEE_DENOMINATOR = 10000;

    /// @notice Default fee rate (0.5%)
    uint16 internal constant DEFAULT_FEE_RATE = 50;

    /**
     * @notice Calculate fee and net amount from a total amount
     * @param amount The total amount
     * @param feeRate The fee rate in basis points
     * @return fee The fee amount
     * @return netAmount The amount after fee deduction
     */
    function calculateFee(
        uint256 amount,
        uint16 feeRate
    ) internal pure returns (uint256 fee, uint256 netAmount) {
        fee = (amount * feeRate) / FEE_DENOMINATOR;
        netAmount = amount - fee;
    }

    /**
     * @notice Validate that a fee rate is within acceptable bounds
     * @param feeRate The fee rate to validate
     */
    function validateFeeRate(uint16 feeRate) internal pure {
        require(feeRate <= MAX_FEE_RATE, "FeeLib: fee rate too high");
    }
}
