import { ethers } from "hardhat";

// command to execute script:
// npx hardhat run ./scripts/PositionManager/addLiquidityPositionManager.ts --network <network name>

const usdt = "0x55d398326f99059fF775485246999027B3197955";

const positionManagerDistributorAddress = "0xDe6421C74308b13ACfB706dF21f1dd3820E929BC";
const amount = ethers.utils.parseEther("1");

export async function main() {
    // Get contract
    const positionManagerDistributor = await ethers.getContractAt("PositionManagerDistributor", positionManagerDistributorAddress);

    const positionManagerAddress = await positionManagerDistributor.positionManager();

    const usdtContract = await ethers.getContractAt("IERC20", usdt);

    const tx = await usdtContract.approve(positionManagerAddress, amount);
    await tx.wait();

    const tx2 = await positionManagerDistributor.deposit(amount, { gasLimit: 800000 });
    await tx2.wait();

    console.log("Deposited to:", positionManagerAddress);
}

main();
