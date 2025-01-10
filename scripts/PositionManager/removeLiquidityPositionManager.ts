import { ethers } from "hardhat";

// command to execute script:
// npx hardhat run ./scripts/PositionManager/removeLiquidityPositionManager.ts --network <network name>

export async function main() {
    // Get contract
    const positionManagerFactory = await ethers.getContractAt("PositionManagerDistributor", "0xd9d14b2da54F7e7aF4c9E63613df4558bF54DC58");

    const tx = await positionManagerFactory.withdraw();
    await tx.wait();

    console.log("Withdrawn liquidity from PositionManagerDistributor");
}

main();
