// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {FullMath} from "@aperture_finance/uni-v3-lib/src/FullMath.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

import {IPositionManagerDistributor} from "../interfaces/positionManager/IPositionManagerDistributor.sol";
import {IFundsDistributor} from "../interfaces/IFundsDistributor.sol";
import {IV3SwapRouter} from "../interfaces/IV3SwapRouter.sol";
import {PositionManager} from "./PositionManager.sol";

contract PositionManagerDistributor is IPositionManagerDistributor, Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev Maximum percentage value.
    uint256 public constant MAX_PERCENTAGE = 1_000_000;

    /// @dev Fee used in swaps from USDT to wnative.
    uint24 public constant FEE = 100;

    error WrongCaller();

    error InvalidEntry();

    event RewardsDistributed(uint256 amount);

    /// @notice Struct for the parameters of the createPositionManager function.
    struct CreatePositionManagerParams {
        address swapRouter;
        bytes usdtToToken0Path;
        bytes usdtToToken1Path;
        bytes token0ToUsdtPath;
        bytes token1ToUsdtPath;
        address dataFeed;
        address pool;
        address fundsDistributor;
        uint256 fundsDistributorPercentage;
    }

    /// @notice Total amount of USDT in the contract owned by the users.
    uint256 public usersTotalBalances;

    /// @notice PositionManager contract.
    PositionManager public immutable positionManager;

    /// @notice Set of users that have deposited USDT.
    EnumerableSet.AddressSet private _usersSet;

    /// @notice Mapping of the balances of the users.
    mapping(address => uint256) private _balances;

    /// @notice USDT address.
    IERC20 public usdt;

    /// @notice WNative address.
    IERC20 public wnative;

    /// @notice SwapRouter address.
    IV3SwapRouter public swapRouter;

    constructor(CreatePositionManagerParams memory params) {
        address _swapRouter = IFundsDistributor(params.fundsDistributor).swapRouter();
        address _wnative = IFundsDistributor(params.fundsDistributor).wnative();
        address _usdt = IFundsDistributor(params.fundsDistributor).usdt();

        if (_usdt == address(0) || _wnative == address(0) || _swapRouter == address(0)) revert InvalidEntry();

        usdt = IERC20(_usdt);
        wnative = IERC20(_wnative);
        swapRouter = IV3SwapRouter(_swapRouter);

        positionManager = new PositionManager(
            params.swapRouter,
            params.usdtToToken0Path,
            params.usdtToToken1Path,
            params.token0ToUsdtPath,
            params.token1ToUsdtPath,
            _usdt,
            params.dataFeed,
            params.pool,
            params.fundsDistributor,
            params.fundsDistributorPercentage
        );

        positionManager.grantRole(0x00, msg.sender);
        positionManager.revokeRole(0x00, address(this));
    }

    /// @notice Deposit USDT to the positionManager.
    function deposit(uint256 depositAmount) external returns (uint256 shares) {
        if (!_usersSet.contains(msg.sender)) _usersSet.add(msg.sender);

        return positionManager.deposit(depositAmount, msg.sender);
    }

    /// @notice Withdraw Funds from the positionManager.
    function withdraw() external {
        positionManager.withdraw(msg.sender);

        if (positionManager.balanceOf(msg.sender) == 0) _usersSet.remove(msg.sender);
    }

    /// @notice Distribute the rewards to the users and FundsDistributor.
    function distributeRewards(address fundsDistributor, uint256 fundsDistributorPercentage) external {
        if (msg.sender != address(positionManager)) revert WrongCaller();

        uint256 contractBalance = usdt.balanceOf(address(this));

        if (contractBalance <= usersTotalBalances) revert InvalidEntry(); // To distribute the surplus

        uint256 amountToDistribute = contractBalance.sub(usersTotalBalances);

        uint256 totalShares = IERC20(positionManager).totalSupply();

        if (totalShares == 0) {
            _approveToken(usdt, address(swapRouter), amountToDistribute);

            uint256 wbnbTotalBalance = swapRouter.exactInputSingle(
                IV3SwapRouter.ExactInputSingleParams({
                    tokenIn: address(usdt),
                    tokenOut: address(wnative),
                    fee: FEE,
                    recipient: address(this),
                    amountIn: amountToDistribute,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );

            wnative.safeTransfer(fundsDistributor, wbnbTotalBalance);

            emit RewardsDistributed(amountToDistribute);
            return;
        }

        // Send fundsDistributorPercentage of the tokens to fundsDistributor
        uint256 fundsDistributorAmount = FullMath.mulDiv(amountToDistribute, fundsDistributorPercentage, MAX_PERCENTAGE);

        _approveToken(usdt, address(swapRouter), fundsDistributorAmount);

        uint256 wbnbBalance = swapRouter.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: address(usdt),
                tokenOut: address(wnative),
                fee: FEE,
                recipient: address(this),
                amountIn: fundsDistributorAmount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        wnative.safeTransfer(fundsDistributor, wbnbBalance);

        amountToDistribute = amountToDistribute.sub(fundsDistributorAmount);

        uint256 usersLength = _usersSet.length();

        usersTotalBalances = usersTotalBalances.add(amountToDistribute);

        for (uint256 i; i < usersLength; i++) {
            address user = _usersSet.at(i);

            // Calculate percentage of the shares over the total supply
            uint256 userPercentage = FullMath.mulDiv(IERC20(positionManager).balanceOf(user), MAX_PERCENTAGE, totalShares);

            // Calculate the amount of USDT of that user using the percentage
            uint256 userUsdt = FullMath.mulDiv(amountToDistribute, userPercentage, MAX_PERCENTAGE);

            if (userUsdt == 0) continue; // Should not happen

            _balances[user] = _balances[user].add(userUsdt);
        }

        emit RewardsDistributed(amountToDistribute.add(fundsDistributorAmount));
    }

    /// @notice Collect the rewards of the user.
    function collectRewards() external {
        uint256 rewards = _balances[msg.sender];

        if (rewards == 0) revert InvalidEntry();

        _balances[msg.sender] = 0;

        usersTotalBalances = usersTotalBalances.sub(rewards);

        IERC20(PositionManager(positionManager).usdt()).safeTransfer(msg.sender, rewards);
    }

    /// @notice Get the balance of the user.
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }

    function _approveToken(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) > 0) token.safeApprove(spender, 0);

        token.safeApprove(spender, amount);
    }
}
