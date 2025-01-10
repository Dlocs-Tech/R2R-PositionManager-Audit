import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers, getNamedAccounts, getChainId } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { allPercentages, Roles } from "../utils/constants";

const version = "v0.0.0";
const contractName = "PositionManagerDistributor";

const usdt = "0x55d398326f99059fF775485246999027B3197955";

const swapRouter = "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2";
const usdtToToken0Path = "0x";
const usdtToToken1Path = "0x55d398326f99059fF775485246999027B3197955000064bb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const token0ToUsdtPath = "0x";
const token1ToUsdtPath = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c00006455d398326f99059fF775485246999027B3197955";
const dataFeed = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";
const pool = "0x172fcD41E0913e95784454622d1c3724f546f849";
const fundsDistributor = "0xDCE30F31ccf1F19C314b8E41586FfdE58aED96D6";
const fundsDistributorPercentage = allPercentages.FundsDistributorPercentage;

const manager = "0xF5Aa4B5fD7681d7479b0d540b29F558fc0040133";

const deployFunction: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployments } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const chainId = parseInt(await getChainId(), 10);

    console.log("\nDeploying " + contractName + "...");

    console.log(`deployer: ${deployer}`);

    const params = {
        swapRouter: swapRouter,
        usdtToToken0Path: usdtToToken0Path,
        usdtToToken1Path: usdtToToken1Path,
        token0ToUsdtPath: token0ToUsdtPath,
        token1ToUsdtPath: token1ToUsdtPath,
        dataFeed: dataFeed,
        pool: pool,
        fundsDistributor: fundsDistributor,
        fundsDistributorPercentage: fundsDistributorPercentage,
    };

    const result = await deploy(contractName, {
        contract: contractName,
        from: deployer,
        log: true,
        waitConfirmations: 1,
        args: [
            params
        ],
    });

    console.log(contractName + " deployed to: ", result.address);

    const PositionManagerDistributor = await ethers.getContractAt(contractName, result.address);

    const PositionManagerAddress = await PositionManagerDistributor.positionManager();

    console.log("PositionManager deployed to:", PositionManagerAddress);

    const PositionManager = await ethers.getContractAt("PositionManager", PositionManagerAddress);

    const tx = await PositionManager.grantRole(Roles.POSITION_MANAGER_ROLE, manager);
    await tx.wait();

    try {
        console.log("Verifying...");
        await hre.run('verify:verify', {
          address: result.address,
          contract: 'contracts/positionManager/PositionManagerDistributor.sol:PositionManagerDistributor',
          constructorArguments: [params],
        });
    } catch (error) {}

    try {
        console.log("Verifying...");
        await hre.run('verify:verify', {
          address: PositionManagerAddress,
          contract: 'contracts/positionManager/PositionManager.sol:PositionManager',
          constructorArguments: [
            swapRouter,
            usdtToToken0Path,
            usdtToToken1Path,
            token0ToUsdtPath,
            token1ToUsdtPath,
            usdt,
            dataFeed,
            pool,
            fundsDistributor,
            fundsDistributorPercentage,
          ],
        });
    } catch (error) {}

    if(chainId == 31337) {
      const params = {
        swapRouter: swapRouter,
        usdtToToken0Path: "0x55d398326f99059fF775485246999027B31979550001F42170Ed0880ac9A755fd29B2688956BD959F933F8", // USDT TO ETH
        usdtToToken1Path: "0x",
        token0ToUsdtPath: "0x2170Ed0880ac9A755fd29B2688956BD959F933F80001F455d398326f99059fF775485246999027B3197955", // ETH TO USDT
        token1ToUsdtPath: "0x",
        dataFeed: "0xB97Ad0E74fa7d920791E90258A6E2085088b4320", // USDT USD
        pool: "0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5", // ETH USDT
        fundsDistributor: fundsDistributor,
        fundsDistributorPercentage: fundsDistributorPercentage,
      };

      const result = await deploy(contractName + "_2", {
        contract: contractName,
        from: deployer,
        log: true,
        waitConfirmations: 1,
        args: [
            params
        ],
      });

      console.log(contractName + " deployed to: ", result.address);

      const PositionManagerDistributor = await ethers.getContractAt(contractName, result.address);

      const PositionManagerAddress = await PositionManagerDistributor.positionManager();

      console.log("PositionManager deployed to:", PositionManagerAddress);

      const PositionManager = await ethers.getContractAt("PositionManager", PositionManagerAddress);

      await PositionManager.grantRole(Roles.POSITION_MANAGER_ROLE, manager);

      const params2 = {
        swapRouter: swapRouter,
        usdtToToken0Path: "0x55d398326f99059fF775485246999027B31979550001F42170Ed0880ac9A755fd29B2688956BD959F933F8", // USDT TO ETH
        usdtToToken1Path: "0x55d398326f99059fF775485246999027B3197955000064bb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // USDT TO WBNB
        token0ToUsdtPath: "0x2170Ed0880ac9A755fd29B2688956BD959F933F80001F455d398326f99059fF775485246999027B3197955", // ETH TO USDT
        token1ToUsdtPath: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c00006455d398326f99059fF775485246999027B3197955", // WBNB TO USDT
        dataFeed: "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE", // price WBNB on USD
        pool: "0xD0e226f674bBf064f54aB47F42473fF80DB98CBA", // ETH WBNB
        fundsDistributor: fundsDistributor,
        fundsDistributorPercentage: fundsDistributorPercentage,
      };

      const result2 = await deploy(contractName + "_3", {
        contract: contractName,
        from: deployer,
        log: true,
        waitConfirmations: 1,
        args: [
            params2
        ],
      });

      console.log(contractName + " deployed to: ", result2.address);

      const PositionManagerDistributor2 = await ethers.getContractAt(contractName, result2.address);

      const PositionManagerAddress2 = await PositionManagerDistributor2.positionManager();

      console.log("PositionManager deployed to:", PositionManagerAddress2);

      const PositionManager2 = await ethers.getContractAt("PositionManager", PositionManagerAddress2);

      await PositionManager2.grantRole(Roles.POSITION_MANAGER_ROLE, manager);

      const params3 = {
        swapRouter: swapRouter,
        usdtToToken0Path: "0x",
        usdtToToken1Path: "0x55d398326f99059fF775485246999027B31979550001F47130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", // USDT TO BTCB
        token0ToUsdtPath: "0x",
        token1ToUsdtPath: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c0001F455d398326f99059fF775485246999027B3197955", // BTCB TO USDT
        dataFeed: "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf", // price BTC on USD
        pool: "0x46Cf1cF8c69595804ba91dFdd8d6b960c9B0a7C4", // USDT BTCB
        fundsDistributor: fundsDistributor,
        fundsDistributorPercentage: fundsDistributorPercentage,
      };

      const result3 = await deploy(contractName + "_4", {
        contract: contractName,
        from: deployer,
        log: true,
        waitConfirmations: 1,
        args: [
            params3
        ],
      });

      console.log(contractName + " deployed to: ", result3.address);

      const PositionManagerDistributor3 = await ethers.getContractAt(contractName, result3.address);

      const PositionManagerAddress3 = await PositionManagerDistributor3.positionManager();

      console.log("PositionManager deployed to:", PositionManagerAddress3);

      const PositionManager3 = await ethers.getContractAt("PositionManager", PositionManagerAddress3);

      await PositionManager3.grantRole(Roles.POSITION_MANAGER_ROLE, manager);
    }

    return true;
};

export default deployFunction;

deployFunction.id = contractName + version;
deployFunction.tags = [contractName, version];
