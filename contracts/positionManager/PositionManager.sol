// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPancakeV3Pool} from "@pancakeswap/v3-core/contracts/interfaces/IPancakeV3Pool.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TickMath} from "@aperture_finance/uni-v3-lib/src/TickMath.sol";
import {FullMath} from "@aperture_finance/uni-v3-lib/src/FullMath.sol";
import {LiquidityAmounts} from "@aperture_finance/uni-v3-lib/src/LiquidityAmounts.sol";
import {IPancakeV3SwapCallback} from "@pancakeswap/v3-core/contracts/interfaces/callback/IPancakeV3SwapCallback.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {IPositionManagerDistributor} from "../interfaces/positionManager/IPositionManagerDistributor.sol";
import {AlgebraUtils} from "../utils/AlgebraUtils.sol";
import {Path} from "../utils/AlgebraPath.sol";
import {FeeManagement} from "./FeeManagement.sol";

/**
 * @title PositionManager.
 * @dev Contract that let users join or leave a position strategy in PancakeSwap managed by a manager..
 *      NOTE: Users deposit USDT and receive shares in return.
 *            Users withdraw shares and receive USDT or Token0 and Token1 in return.
 *
 *            The operator can make the contract open or close a position with the funds deposited by the users.
 */
contract PositionManager is FeeManagement, IPancakeV3SwapCallback, AccessControl, ReentrancyGuard, ERC20 {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using SafeMath for uint160;
    using SafeMath for uint128;
    using Path for bytes;

    /// @notice Precision used in the contract.
    uint256 public constant PRECISION = 1e36;

    /// @notice Manager role
    bytes32 public constant MANAGER_ROLE = keccak256("Position_Manager_Role");

    error InvalidInput();

    error InsufficientBalance();

    error NotPool();

    event Deposit(address indexed user, uint256 shares, uint256 depositAmount);

    event Withdraw(address indexed user, uint256 shares);

    event FundsCollected(uint256 amount);

    event LiquidityAdded(int24 tickLower, int24 tickUpper);

    event LiquidityRemoved(int24 tickLower, int24 tickUpper);

    event PositionHarvested();

    /// @notice Address of the swap router.
    address public immutable swapRouter;

    /// @dev Address of the data feed used to get the token1 price in USD.
    AggregatorV3Interface internal immutable dataFeed;

    /// @notice Address of the PancakeSwap V3 pool.
    IPancakeV3Pool public immutable pool;

    /// @notice Factory address.
    address public immutable factory;

    /// @notice Address of the funds distributor contract.
    address public fundsDistributor;

    /// @notice Token0 of the pool.
    IERC20 private immutable token0;

    /// @notice Token1 of the pool.
    IERC20 private immutable token1;

    /// @notice Percentage of the funds destined to the funds distributor.
    uint256 public fundsDistributorPercentage;

    /// @notice Max slippage percentage allowed in swaps.
    uint256 private slippage = 10000; // 1%

    /// @notice Path used to swap USDT to token0.
    bytes public usdtToToken0Path;

    /// @notice Path used to swap USDT to token1.
    bytes public usdtToToken1Path;

    /// @notice Path used to swap token0 to USDT.
    bytes public token0ToUsdtPath;

    /// @notice Path used to swap token1 to USDT.
    bytes public token1ToUsdtPath;

    /// @dev Lower tick of the position.
    int24 internal _tickLower;

    /// @dev Upper tick of the position.
    int24 internal _tickUpper;

    /// @notice Bool switch to prevent reentrancy on the mint callback.
    bool private minting;

    modifier onlyFactory() {
        if (msg.sender != factory) revert InvalidEntry();
        _;
    }

    constructor(
        address _swapRouter,
        bytes memory _usdtToToken0Path,
        bytes memory _usdtToToken1Path,
        bytes memory _token0ToUsdtPath,
        bytes memory _token1ToUsdtPath,
        address _usdt,
        address _dataFeed,
        address _pool,
        address _fundsDistributor,
        uint256 _fundsDistributorPercentage
    ) ERC20("PositionManager", "PM") {
        if (
            _swapRouter == address(0) ||
            _usdt == address(0) ||
            _dataFeed == address(0) ||
            _pool == address(0) ||
            _fundsDistributor == address(0) ||
            _fundsDistributorPercentage > MAX_PERCENTAGE ||
            _fundsDistributorPercentage == 0
        ) revert InvalidInput();

        swapRouter = _swapRouter;

        usdtToToken0Path = _usdtToToken0Path;
        usdtToToken1Path = _usdtToToken1Path;

        token0ToUsdtPath = _token0ToUsdtPath;
        token1ToUsdtPath = _token1ToUsdtPath;

        usdt = IERC20(_usdt);

        dataFeed = AggregatorV3Interface(_dataFeed);

        pool = IPancakeV3Pool(_pool);

        token0 = IERC20(pool.token0());
        token1 = IERC20(pool.token1());

        fundsDistributor = _fundsDistributor;

        fundsDistributorPercentage = _fundsDistributorPercentage;

        factory = msg.sender;

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Function to deposit USDT and receive shares in return.
     * @param depositAmount Amount of USDT to deposit.
     * @return shares Amount of shares received.
     * @dev The user must approve the contract to spend the USDT before calling this function.
     */
    function deposit(uint256 depositAmount, address sender) external onlyFactory returns (uint256 shares) {
        if (depositAmount == 0) revert InvalidInput();

        // Transfer USDT from user to contract
        usdt.safeTransferFrom(sender, address(this), depositAmount);

        depositAmount = _chargeDepositFee(depositAmount);

        // Invest the USDT in the current position if the contract is in position
        if (_tickLower != _tickUpper) {
            // Swap user USDT to token1
            uint256 userLiq = _swapUsingPath(usdtToToken1Path, depositAmount);

            if (usdt.balanceOf(address(this)) > 0) _swapUsingPath(usdtToToken1Path, usdt.balanceOf(address(this)));

            uint256 totalLiq = token1.balanceOf(address(this));

            harvest();

            // Burn liquidity from the position
            _burnLiquidity(_tickLower, _tickUpper, _liquidityForShares(_tickLower, _tickUpper, totalSupply()));

            // Calculate the price of token1 over token0
            (, int24 tick) = _priceAndTick();

            uint160 sqrtPriceByTick = TickMath.getSqrtRatioAtTick(tick);

            uint256 price = FullMath.mulDiv(uint256(sqrtPriceByTick).mul(uint256(sqrtPriceByTick)), PRECISION, 2 ** (96 * 2));

            // Calculate contract balance in token1
            (uint256 pool0, uint256 pool1) = _getTotalAmounts();

            pool1 = pool1.sub(userLiq);

            uint256 token1ContractAmount = (pool0.mul(price).div(PRECISION)).add(pool1);

            // Calculate shares to mint (totalSupply cannot be 0 if the contract is in position)
            shares = userLiq.mul(totalSupply()).div(token1ContractAmount);

            // Calculate the amount of token1 to swap
            uint256 percentage0 = getRangePercentage((totalLiq).mul(PRECISION).div(price), totalLiq);

            uint256 amount1ToSwap = (totalLiq).mul(percentage0).div(PRECISION);

            // Approve token1 to pool
            _approveToken(token1, address(pool), amount1ToSwap);

            pool.swap(
                address(this),
                false, // token1 to token0
                int256(amount1ToSwap),
                uint160(sqrtPriceByTick.mul(MAX_PERCENTAGE.add(slippage)).div(MAX_PERCENTAGE)),
                ""
            );

            _addLiquidity();
        } else {
            // Case when the contract is not in position
            // Calculate the price of token1 over token0
            uint256 token1Price = _getChainlinkPrice().mul(PRECISION);

            // Calculate the amount of shares to mint
            shares = depositAmount.mul(token1Price).div(PRECISION);

            if (totalSupply() > 0) {
                uint256 contractAmount = usdt.balanceOf(address(this)).sub(depositAmount);

                uint256 token1ContractAmount = contractAmount.mul(token1Price).div(PRECISION);

                shares = shares.mul(totalSupply()).div(token1ContractAmount);
            }
        }

        _mint(sender, shares);

        emit Deposit(sender, shares, depositAmount);
    }

    /**
     * @notice Function to withdraw shares and receive funds in return.
     * @dev The user must have shares to withdraw.
     *      NOTE: If the contract is in position, the user will receive token0 and token1.
     *            If the contract is not in position, the user will receive USDT.
     */
    function withdraw(address sender) external onlyFactory nonReentrant {
        uint256 shares = balanceOf(sender);

        if (shares == 0) revert InsufficientBalance();

        // Contract is in position
        if (_tickLower != _tickUpper) {
            harvest();

            // Burn liquidity from the position
            _burnLiquidity(_tickLower, _tickUpper, _liquidityForShares(_tickLower, _tickUpper, totalSupply()));

            uint256 userAmount0 = token0.balanceOf(address(this)).mul(shares).div(totalSupply());
            uint256 userAmount1 = token1.balanceOf(address(this)).mul(shares).div(totalSupply());

            if (userAmount0 > 0) token0.safeTransfer(sender, userAmount0);
            if (userAmount1 > 0) token1.safeTransfer(sender, userAmount1);

            if (totalSupply() == shares)
                _tickLower = _tickUpper = 0; // Set the contract to not in position
            else _addLiquidity();
        } else {
            // Contract is not in position
            // Calculate the contract balance in token1
            uint256 contractAmount = usdt.balanceOf(address(this));

            // Calculate the amount of usdt to send to the user
            uint256 userUsdtAmount = contractAmount.mul(shares).div(totalSupply());

            usdt.safeTransfer(sender, userUsdtAmount);
        }

        _burn(sender, shares);

        emit Withdraw(sender, shares);
    }

    /**
     * @notice Function to add liquidity to the position.
     * @param tickLower Lower tick of the position.
     * @param tickUpper Upper tick of the position.
     * @dev Only the manager can call this function.
     */
    function addLiquidity(int24 tickLower, int24 tickUpper) external onlyRole(MANAGER_ROLE) {
        // Only add liquidity if the contract is not in position and there are funds in the contract
        if (_tickLower != _tickUpper) revert InvalidEntry();
        if (totalSupply() == 0) revert InvalidInput(); // Shouldn't happen

        if (tickLower > tickUpper) revert InvalidInput();

        _tickLower = tickLower;
        _tickUpper = tickUpper;

        harvest();

        // Swap USDT to token1
        uint256 usdtAmount = usdt.balanceOf(address(this));

        if (usdtAmount == 0) revert InvalidEntry();

        uint256 contractLiq = _swapUsingPath(usdtToToken1Path, usdtAmount);

        // Calculate the price of token1 over token0
        (, int24 tick) = _priceAndTick();

        uint160 sqrtPriceByTick = TickMath.getSqrtRatioAtTick(tick);

        uint256 price = FullMath.mulDiv(uint256(sqrtPriceByTick).mul(uint256(sqrtPriceByTick)), PRECISION, 2 ** (96 * 2));

        // Calculate the amount of token1 to swap
        uint256 percentage0 = getRangePercentage(contractLiq.mul(PRECISION).div(price), contractLiq);

        uint256 amount1ToSwap = contractLiq.mul(percentage0).div(PRECISION);

        if (amount1ToSwap != 0) {
            // If current tick is out of the range, couldn't swap
            // Approve token1 to pool
            _approveToken(token1, address(pool), amount1ToSwap);

            pool.swap(
                address(this),
                false, // token1 to token0
                int256(amount1ToSwap),
                uint160(sqrtPriceByTick.mul(MAX_PERCENTAGE.add(slippage)).div(MAX_PERCENTAGE)),
                ""
            );
        }

        _addLiquidity();
    }

    /**
     * @notice Function to remove liquidity from the position.
     * @dev Only the manager can call this function.
     */
    function removeLiquidity() external onlyRole(MANAGER_ROLE) {
        // Only remove liquidity if the contract is in position
        if (_tickLower == _tickUpper) revert InvalidInput();
        if (totalSupply() == 0) revert InvalidInput(); // Shouldn't happen

        harvest();

        _burnLiquidity(_tickLower, _tickUpper, _liquidityForShares(_tickLower, _tickUpper, totalSupply()));

        // Swap token0 and token1 to USDT
        (uint256 pool0, uint256 pool1) = _getTotalAmounts();

        _swapUsingPath(token0ToUsdtPath, pool0);
        _swapUsingPath(token1ToUsdtPath, pool1);

        // Set the contract to not in position
        _tickLower = _tickUpper = 0;
    }

    /// @notice Function to collect the fees accumulated by the position and send them to the factory.
    function harvest() public {
        (uint256 pool0Before, uint256 pool1Before) = _getTotalAmounts();

        // Collect fees
        _collect();

        (uint256 pool0After, uint256 pool1After) = _getTotalAmounts();

        uint256 amount0 = pool0After.sub(pool0Before);
        uint256 amount1 = pool1After.sub(pool1Before);

        // Swap token0 and token1 to USDT
        amount0 = _swapUsingPath(token0ToUsdtPath, amount0);
        amount1 = _swapUsingPath(token1ToUsdtPath, amount1);

        if (amount0.add(amount1) > 0) usdt.safeTransfer(factory, amount0 + amount1);
    }

    /// @notice Function to distribute the rewards.
    function distributeRewards() external {
        IPositionManagerDistributor(factory).distributeRewards(fundsDistributor, fundsDistributorPercentage);
    }

    /// @dev This percentage is of amount0.
    function getRangePercentage(uint256 amount0, uint256 amount1) public view returns (uint256) {
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(_tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(_tickUpper);

        uint128 liquidity0 = LiquidityAmounts.getLiquidityForAmount0Sorted(sqrtPriceX96, sqrtRatioBX96, amount0);
        uint128 liquidity1 = LiquidityAmounts.getLiquidityForAmount1Sorted(sqrtRatioAX96, sqrtPriceX96, amount1);

        return liquidity0.mul(uint128(PRECISION)).div(liquidity0.add(liquidity1));
    }

    /// @notice Function to get the current tick range of the position.
    /// @dev The ticks are the same if the contract is not in position.
    function getTickRange() public view returns (int24, int24) {
        return (_tickLower, _tickUpper);
    }

    function getAmount0ForLiquidity(uint160 sqrtRatioAX96, uint160 sqrtRatioBX96, uint128 liquidity) external pure returns (uint256 amount0) {
        return LiquidityAmounts.getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
    }

    function setFundsDistributor(address _fundsDistributor, uint256 _fundsDistributorPercentage) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_fundsDistributorPercentage > MAX_PERCENTAGE || _fundsDistributorPercentage == 0 || _fundsDistributor == address(0)) revert InvalidInput();

        fundsDistributor = _fundsDistributor;
        fundsDistributorPercentage = _fundsDistributorPercentage;
    }

    function setUsdtToToken0Path(bytes memory _usdtToToken0Path) external onlyRole(DEFAULT_ADMIN_ROLE) {
        usdtToToken0Path = _usdtToToken0Path;
    }

    function setUsdtToToken1Path(bytes memory _usdtToToken1Path) external onlyRole(DEFAULT_ADMIN_ROLE) {
        usdtToToken1Path = _usdtToToken1Path;
    }

    function setToken0ToUsdtPath(bytes memory _token0ToUsdtPath) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token0ToUsdtPath = _token0ToUsdtPath;
    }

    function setToken1ToUsdtPath(bytes memory _token1ToUsdtPath) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token1ToUsdtPath = _token1ToUsdtPath;
    }

    function setSlippage(uint256 _slippage) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_slippage > MAX_PERCENTAGE) revert InvalidInput();
        slippage = _slippage;
    }

    /**
     * @notice The sqrt price and the current tick of the pool.
     * @return sqrtPriceX96 The sqrt price of the pool.
     * @return tick The current tick of the pool.
     */
    function _priceAndTick() internal view returns (uint160 sqrtPriceX96, int24 tick) {
        (sqrtPriceX96, tick, , , , , ) = pool.slot0();
    }

    function _getTotalAmounts() public view returns (uint256 total0, uint256 total1) {
        total0 = token0.balanceOf(address(this));
        total1 = token1.balanceOf(address(this));
    }

    function _getChainlinkPrice() internal view returns (uint256) {
        (, int256 price, , , ) = dataFeed.latestRoundData();
        return (uint256(price));
    }

    function _swapUsingPath(bytes memory path, uint256 amount) internal returns (uint256) {
        if (path.length == 0 || amount == 0) return amount;

        (address pathToken0, ) = path.decodeFirstPool();

        _approveToken(IERC20(pathToken0), swapRouter, amount);

        return AlgebraUtils.swap(swapRouter, path, amount);
    }

    function _liquidityForShares(int24 tickLower, int24 tickUpper, uint256 shares) internal view returns (uint128) {
        uint128 position = _position(tickLower, tickUpper);
        return _uint128Safe(uint256(position).mul(shares).div(totalSupply()));
    }

    function _position(int24 tickLower, int24 tickUpper) internal view returns (uint128 liquidity) {
        bytes32 positionKey = keccak256(abi.encodePacked(address(this), tickLower, tickUpper));
        (liquidity, , , , ) = pool.positions(positionKey);
    }

    function _uint128Safe(uint256 x) internal pure returns (uint128) {
        assert(x <= type(uint128).max);
        return uint128(x);
    }

    /// @notice Adds liquidity to the position.
    function _addLiquidity() private {
        (uint256 bal0, uint256 bal1) = _getTotalAmounts();

        // Then we fetch how much liquidity we get for adding at the main position ticks with our token balances.
        (uint160 price, ) = _priceAndTick();

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            price,
            TickMath.getSqrtRatioAtTick(_tickLower),
            TickMath.getSqrtRatioAtTick(_tickUpper),
            bal0,
            bal1
        );

        // Flip minting to true and call the pool to mint the liquidity.
        minting = true;
        IPancakeV3Pool(pool).mint(address(this), _tickLower, _tickUpper, liquidity, "");
    }

    /// @notice Burns liquidity from the position.
    function _burnLiquidity(int24 tickLower, int24 tickUpper, uint128 liquidity) internal {
        if (liquidity > 0) {
            // Burn liquidity
            pool.burn(tickLower, tickUpper, liquidity);

            // Collect amount owed
            _collect();
        }
    }

    function _collect() internal {
        /// get position data from _position()
        uint128 liquidity = _position(_tickLower, _tickUpper);

        // trigger an update of the position fees owed and fee growth snapshots if it has any liquidity
        if (liquidity > 0) pool.burn(_tickLower, _tickUpper, 0);

        // the actual amounts collected are returned
        pool.collect(address(this), _tickLower, _tickUpper, type(uint128).max, type(uint128).max);
    }

    function _approveToken(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) > 0) token.safeApprove(spender, 0);

        token.safeApprove(spender, amount);
    }

    /**
     * @notice Callback function for PancakeSwap V3 pool to call when minting liquidity.
     * @param amount0 Amount of token0 owed to the pool
     * @param amount1 Amount of token1 owed to the pool
     * bytes Additional data but unused in this case.
     */
    function pancakeswapV3MintCallback(uint256 amount0, uint256 amount1, bytes memory /*data*/) external {
        if (msg.sender != address(pool)) revert NotPool();
        if (!minting) revert InvalidEntry();

        if (amount0 > 0) token0.safeTransfer(address(pool), amount0);
        if (amount1 > 0) token1.safeTransfer(address(pool), amount1);
        minting = false;
    }

    function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata /*data*/) external {
        if (msg.sender != address(pool)) revert NotPool();
        if (amount0Delta > 0) {
            IERC20(IPancakeV3Pool(msg.sender).token0()).safeTransfer(msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(IPancakeV3Pool(msg.sender).token1()).safeTransfer(msg.sender, uint256(amount1Delta));
        }
    }

    function pancakeV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata /*data*/) external {
        if (msg.sender != address(pool)) revert NotPool();

        if (amount0Owed > 0) {
            IERC20(IPancakeV3Pool(msg.sender).token0()).safeTransfer(msg.sender, uint256(amount0Owed));
        }
        if (amount1Owed > 0) {
            IERC20(IPancakeV3Pool(msg.sender).token1()).safeTransfer(msg.sender, uint256(amount1Owed));
        }
    }
}
