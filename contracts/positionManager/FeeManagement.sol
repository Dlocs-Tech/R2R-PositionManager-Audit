// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FullMath} from "@aperture_finance/uni-v3-lib/src/FullMath.sol";

contract FeeManagement {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PERCENTAGE = 1_000_000; // 100%

    uint256 public constant MAX_FEE_PERCENTAGE = 100_000; // 10%

    error InvalidEntry();

    event FeeChanged(uint256 depositFee, address feeReceiver);

    event FeeCharged(uint256 fee);

    /// @notice Address of the USDT token.
    IERC20 public immutable usdt;

    uint256 public depositFee;

    address public feeReceiver;

    function _setFee(uint256 _depositFee, address _feeReceiver) internal {
        if (_depositFee > MAX_FEE_PERCENTAGE) {
            revert InvalidEntry();
        }

        depositFee = _depositFee;
        feeReceiver = _feeReceiver;

        emit FeeChanged(_depositFee, _feeReceiver);
    }

    function _chargeDepositFee(uint256 amount) internal returns (uint256) {
        uint256 fee = FullMath.mulDiv(amount, depositFee, MAX_PERCENTAGE);

        _chargeFee(fee);

        return amount - fee;
    }

    function _chargeFee(uint256 fee) internal {
        if (fee > 0) {
            usdt.safeTransfer(feeReceiver, fee);

            emit FeeCharged(fee);
        }
    }
}
