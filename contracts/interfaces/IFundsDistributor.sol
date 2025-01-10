/// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFundsDistributor {
    function usdt() external view returns (address);
    function wnative() external view returns (address);
    function swapRouter() external view returns (address);
}
