import { Roles } from "../../utils/constants";
import { ethers } from "hardhat";

// command to execute script:
// npx hardhat run ./scripts/PositionManager/grantManagerRole.ts --network <network name>

const manager = "0x21151F4eF2e4680EBdC9A9ebAAa54610d9efF57f";

export async function main() {
    // Get contract
    const PositionManagerDistributor = await ethers.getContractAt("PositionManagerDistributor", "0xfc3492D9bBb60c4927384e2348c363274f16AE6C");

    const PositionManagerAddress = await PositionManagerDistributor.positionManager();

    console.log("PositionManager deployed to:", PositionManagerAddress);

    const PositionManager = await ethers.getContractAt("PositionManager", PositionManagerAddress);

    const tx = await PositionManager.grantRole(Roles.POSITION_MANAGER_ROLE, manager);
    await tx.wait();

    console.log("Role granted!");
}

main();