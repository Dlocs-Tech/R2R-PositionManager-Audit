import {expect} from "chai";
import {ethers, deployments} from "hardhat";
import {Roles, allPercentages} from "../utils/constants";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {PositionManagerDistributor, IERC20} from "../typechain";
import {BigNumber} from "ethers";

export default async function suite(): Promise<void> {
    describe("PositionManager USDT/WBNB", function () {
        let snap: string;
        let PositionManagerDistributor: PositionManagerDistributor;
        let PositionManager: any;

        let deployer: SignerWithAddress;
        let manager: SignerWithAddress;
        let user1: SignerWithAddress;
        let user2: SignerWithAddress;
        let user3: SignerWithAddress;
        let user4: SignerWithAddress;
        let FundsDistributor: SignerWithAddress;

        let USDTAddress = "0x55d398326f99059fF775485246999027B3197955";
        let WBNBAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

        let USDTContract: IERC20;
        let WBNBContract: IERC20;

        const wbnbToUsdt: BigNumber = ethers.utils.parseEther("615.40830210"); // 1 WBNB = 615.40830210 USDT

        const bnbChainLinkPrice: BigNumber = BigNumber.from(61540830210); // 61540830210 USDT

        const minTick: BigNumber = BigNumber.from(-887272);
        const maxTick: BigNumber = BigNumber.from(887272);

        const maxPercentage = 1000000;

        let RouterAddress = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

        before(async function () {
            await deployments.fixture(["PositionManagerDistributor"]);

            PositionManagerDistributor = await ethers.getContract("PositionManagerDistributor");

            [deployer, manager, user1, user2, user3, user4, FundsDistributor] = await ethers.getSigners();

            const PositionManagerAddress = await PositionManagerDistributor.positionManager();

            PositionManager = await ethers.getContractAt("PositionManager", PositionManagerAddress);

            await PositionManager.setFundsDistributor(FundsDistributor.address, allPercentages.FundsDistributorPercentage);

            USDTContract = (await ethers.getContractAt("IERC20", USDTAddress)) as IERC20;
            WBNBContract = (await ethers.getContractAt("IERC20", WBNBAddress)) as IERC20;

            await PositionManager.connect(deployer).grantRole(Roles.POSITION_MANAGER_ROLE, manager.address);

            const holderAddress = "0x98cF4F4B03a4e967D54a3d0aeC9fCA90851f2Cca";

            await hre.network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [holderAddress],
            });

            await deployer.sendTransaction({
                to: holderAddress,
                value: ethers.utils.parseEther("1"), // Send 1 BNB
            });

            // Get the holder signer
            const holderSigner = await ethers.getSigner(holderAddress);

            // Send 10000 USDT to the deployer
            await USDTContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("10000", "18"));

            // Send 5000 WBNB to the deployer
            await WBNBContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("5000", "18"));

            // Stop impersonating the holder address
            await hre.network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [holderAddress],
            });
        });

        beforeEach(async function () {
            snap = await ethers.provider.send("evm_snapshot", []);
        });

        afterEach(async function () {
            await ethers.provider.send("evm_revert", [snap]);
        });

        it("Should deposit USDT into Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(expectedShares);
        });

        it("Should deposit and withdraw USDT from Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should manager add liquidity to the pool", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));
        });

        it("Should user deposit USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(bnbChainLinkPrice).sub("11544259944171165170493714506"); // This value is added manually but after checking that is an acceptable value

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(amount.mul(bnbChainLinkPrice).add(expectedShares));
        });

        it("Should user withdraw USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should two users deposit USDT, then add liquidity and user1 withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount.mul(2));

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user2).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user2.address, expectedShares);

            const user2NewBalance = await PositionManager.balanceOf(user2.address);

            expect(user2NewBalance).to.be.eq(0);

            const user1Balance = await PositionManager.balanceOf(user1.address);

            expect(user1Balance).to.be.eq(expectedShares);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const user1NewBalance = await PositionManager.balanceOf(user1.address);

            expect(user1NewBalance).to.be.eq(0);
        });

        it("Should deposit and add liquidity with different tick values (in range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-64000, -63000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (under range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-61000, -60000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (over range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-62000, -61000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity and remove liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            await PositionManager.connect(manager).removeLiquidity();

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("1"));
        });

        it("Should deposit 3 times (different users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user4).deposit(amount);

            const expectedShares2 = amount.mul(bnbChainLinkPrice).sub("11544259944171165170493714506"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(bnbChainLinkPrice).sub("25214447479166057495782284532"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(bnbChainLinkPrice).sub("39589289894336409612568127053"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user2).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user4).withdraw();

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user2WBNBBalanceInWBNB = await WBNBContract.balanceOf(user2.address);
            const user2WBNBBalance = user2WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2USDTBalance.add(user2WBNBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user3WBNBBalanceInWBNB = await WBNBContract.balanceOf(user3.address);
            const user3WBNBBalance = user3WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3USDTBalance.add(user3WBNBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("2"));

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4USDTBalance = await USDTContract.balanceOf(user4.address);
            const user4WBNBBalanceInWBNB = await WBNBContract.balanceOf(user4.address);
            const user4WBNBBalance = user4WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4USDTBalance.add(user4WBNBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw in other order", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user4).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            const expectedShares2 = amount.mul(bnbChainLinkPrice).sub("39589289894336409612568127053"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(bnbChainLinkPrice).sub("25214447479166057495782284532"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(bnbChainLinkPrice).sub("11544259944171165170493714506"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user4).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user2).withdraw();

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4USDTBalance = await USDTContract.balanceOf(user4.address);
            const user4WBNBBalanceInWBNB = await WBNBContract.balanceOf(user4.address);
            const user4WBNBBalance = user4WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4USDTBalance.add(user4WBNBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user3WBNBBalanceInWBNB = await WBNBContract.balanceOf(user3.address);
            const user3WBNBBalance = user3WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3USDTBalance.add(user3WBNBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("2"));

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user2WBNBBalanceInWBNB = await WBNBContract.balanceOf(user2.address);
            const user2WBNBBalance = user2WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2USDTBalance.add(user2WBNBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity, and withdraw will close position, so we can deposit and add liquidity again", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await PositionManagerDistributor.connect(user1).withdraw();

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(0);

            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);
            expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares2 = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);
        });

        it("Should add and remove liquidity 10 times, then withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            for (let i = 0; i < 10; i++) {
                await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.002"));
                expect(await WBNBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

                await PositionManager.connect(manager).removeLiquidity();

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("6"));
            }

            // Lose max 6 USDT in 10 add/remove liquidity
            await PositionManagerDistributor.connect(user1).withdraw();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.closeTo(amount, ethers.utils.parseEther("6"));
        });

        it("Should set a deposit fee and charge it in a deposit", async function () {
            const amount = ethers.utils.parseEther("1000");

            const amountAfterFee = amount.mul(900000).div(1000000);

            const amountCharged = amount.sub(amountAfterFee);

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManager.connect(manager).setFee(100000, user2.address);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amountAfterFee);

            expect(await PositionManager.balanceOf(user1.address)).to.be.closeTo(amountAfterFee.mul(bnbChainLinkPrice), ethers.utils.parseEther("1"));

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            expect(user1USDTBalance).to.be.equal(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            expect(user2USDTBalance).to.be.equal(amountCharged);
        });

        it("revert: fails to distribute rewards if the contract has no balance", async function () {
            await expect(PositionManager.distributeRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("should distribute to the fundsDistributor (zero users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(amount.mul("1000000000000000000").div(wbnbToUsdt), ethers.utils.parseEther("0.01"));
        });

        it("an user deposits and distributeRewards is called", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);
            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(amount.sub(expectedFundsDistributorBalance));
        });

        it("revert: an user cannot collect rewards if the contract has no balance", async function () {
            await expect(PositionManagerDistributor.connect(user1).collectRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("an user deposits, distributeRewards is called and the user collects rewards", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            await PositionManagerDistributor.connect(user1).collectRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const expectedUser1USDTBalance = amount.sub(expectedFundsDistributorBalance);

            expect(user1USDTBalance).to.be.equal(expectedUser1USDTBalance);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const PositionManagerDistributorBalance = await USDTContract.balanceOf(PositionManagerDistributor.address);

            expect(PositionManagerDistributorBalance).to.be.equal(0);
        });

        it("4 users deposit differents amounts and distributeRewards is called", async function () {
            const amount1 = ethers.utils.parseEther("500");
            const amount2 = ethers.utils.parseEther("1000");
            const amount3 = ethers.utils.parseEther("1500");
            const amount4 = ethers.utils.parseEther("2000");

            await USDTContract.connect(deployer).transfer(user1.address, amount1);
            await USDTContract.connect(deployer).transfer(user2.address, amount2);
            await USDTContract.connect(deployer).transfer(user3.address, amount3);
            await USDTContract.connect(deployer).transfer(user4.address, amount4);

            await USDTContract.connect(user1).approve(PositionManager.address, amount1);
            await USDTContract.connect(user2).approve(PositionManager.address, amount2);
            await USDTContract.connect(user3).approve(PositionManager.address, amount3);
            await USDTContract.connect(user4).approve(PositionManager.address, amount4);

            await PositionManagerDistributor.connect(user1).deposit(amount1);
            await PositionManagerDistributor.connect(user2).deposit(amount2);
            await PositionManagerDistributor.connect(user3).deposit(amount3);
            await PositionManagerDistributor.connect(user4).deposit(amount4);

            const totalAmount = amount1.add(amount2).add(amount3).add(amount4);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, totalAmount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user4USDTBalance = await USDTContract.balanceOf(user4.address);

            expect(user1USDTBalance).to.be.equal(0);
            expect(user2USDTBalance).to.be.equal(0);
            expect(user3USDTBalance).to.be.equal(0);
            expect(user4USDTBalance).to.be.equal(0);

            const expectedFundsDistributorBalance = totalAmount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.01")
            );

            const expectedFundsDistributorBalanceUser1 = amount1.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser2 = amount2.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser3 = amount3.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser4 = amount4.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);
            const user2ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user2.address);
            const user3ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user3.address);
            const user4ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user4.address);

            const expectedUser1USDTBalance = amount1.sub(expectedFundsDistributorBalanceUser1);
            const expectedUser2USDTBalance = amount2.sub(expectedFundsDistributorBalanceUser2);
            const expectedUser3USDTBalance = amount3.sub(expectedFundsDistributorBalanceUser3);
            const expectedUser4USDTBalance = amount4.sub(expectedFundsDistributorBalanceUser4);

            expect(user1ContractUSDTBalance).to.be.equal(expectedUser1USDTBalance);
            expect(user2ContractUSDTBalance).to.be.equal(expectedUser2USDTBalance);
            expect(user3ContractUSDTBalance).to.be.equal(expectedUser3USDTBalance);
            expect(user4ContractUSDTBalance).to.be.equal(expectedUser4USDTBalance);
        });
    });

    describe("PositionManager ETH/USDT", function () {
        let snap: string;
        let FundsDistributor: any;
        let PositionManagerDistributor: PositionManagerDistributor;
        let PositionManager: any;

        let deployer: SignerWithAddress;
        let manager: SignerWithAddress;
        let user1: SignerWithAddress;
        let user2: SignerWithAddress;
        let user3: SignerWithAddress;
        let user4: SignerWithAddress;

        let USDTAddress = "0x55d398326f99059fF775485246999027B3197955";
        let ETHAddress = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";
        let WBNBAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

        let USDTContract: IERC20;
        let ETHContract: IERC20;
        let WBNBContract: IERC20;

        const wbnbToUsdt: BigNumber = ethers.utils.parseEther("615.40830210"); // 1 WBNB = 615.40830210 USDT
        const ethToUsdt: BigNumber = ethers.utils.parseEther("3359"); // 1 ETH = 3359 USDT

        const usdChainLinkPrice: BigNumber = BigNumber.from(99962487);

        const minTick: BigNumber = BigNumber.from(-887270);
        const maxTick: BigNumber = BigNumber.from(887270);

        const maxPercentage = 1000000;

        let RouterAddress = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

        before(async function () {
            await deployments.fixture(["PositionManagerDistributor"]);

            PositionManagerDistributor = await ethers.getContract("PositionManagerDistributor_2");

            [deployer, manager, user1, user2, user3, user4, FundsDistributor] = await ethers.getSigners();

            const PositionManagerAddress = await PositionManagerDistributor.positionManager();

            PositionManager = await ethers.getContractAt("PositionManager", PositionManagerAddress);

            await PositionManager.setFundsDistributor(FundsDistributor.address, allPercentages.FundsDistributorPercentage);

            USDTContract = (await ethers.getContractAt("IERC20", USDTAddress)) as IERC20;
            ETHContract = (await ethers.getContractAt("IERC20", ETHAddress)) as IERC20;
            WBNBContract = (await ethers.getContractAt("IERC20", WBNBAddress)) as IERC20;

            await PositionManager.connect(deployer).grantRole(Roles.POSITION_MANAGER_ROLE, manager.address);

            const holderAddress = "0x98cF4F4B03a4e967D54a3d0aeC9fCA90851f2Cca";

            await hre.network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [holderAddress],
            });

            await deployer.sendTransaction({
                to: holderAddress,
                value: ethers.utils.parseEther("1"), // Send 1 BNB
            });

            // Get the holder signer
            const holderSigner = await ethers.getSigner(holderAddress);

            // Send 10000 USDT to the deployer
            await USDTContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("10000", "18"));

            // Send 300 ETH to the deployer
            await ETHContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("300", "18"));

            // Stop impersonating the holder address
            await hre.network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [holderAddress],
            });
        });

        beforeEach(async function () {
            snap = await ethers.provider.send("evm_snapshot", []);
        });

        afterEach(async function () {
            await ethers.provider.send("evm_revert", [snap]);
        });

        it("Should deposit USDT into Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(usdChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(expectedShares);
        });

        it("Should deposit and withdraw USDT from Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(usdChainLinkPrice);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should manager add liquidity to the pool", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);
            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
        });

        it("Should user deposit USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(usdChainLinkPrice).add("26973822631336701195634853"); // This value is added manually but after checking that is an acceptable value

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(amount.mul(usdChainLinkPrice).add(expectedShares));
        });

        it("Should user withdraw USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(usdChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should two users deposit USDT, then add liquidity and user1 withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount.mul(2));

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.5"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(usdChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user2).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user2.address, expectedShares);

            const user2NewBalance = await PositionManager.balanceOf(user2.address);

            expect(user2NewBalance).to.be.eq(0);

            const user1Balance = await PositionManager.balanceOf(user1.address);

            expect(user1Balance).to.be.eq(expectedShares);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const user1NewBalance = await PositionManager.balanceOf(user1.address);

            expect(user1NewBalance).to.be.eq(0);
        });

        it("Should deposit and add liquidity with different tick values (in range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-64000, -63000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);

            const expectedShares = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (under range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-65000, -64000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (over range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-62000, -61000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity and remove liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            await PositionManager.connect(manager).removeLiquidity();

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("1"));
        });

        it("Should deposit 3 times (different users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);

            const expectedShares = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user4).deposit(amount);

            const expectedShares2 = amount.mul(usdChainLinkPrice).add("26973822631336701195634853"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(usdChainLinkPrice).add("41239428361799867549678997"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(usdChainLinkPrice).add("46265780644161037891073611"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user2).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user4).withdraw();

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user2ETHBalanceInETH = await ETHContract.balanceOf(user2.address);
            const user2ETHBalance = user2ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2USDTBalance.add(user2ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("2"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user3ETHBalanceInETH = await ETHContract.balanceOf(user3.address);
            const user3ETHBalance = user3ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3USDTBalance.add(user3ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("2"));

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4USDTBalance = await USDTContract.balanceOf(user4.address);
            const user4ETHBalanceInETH = await ETHContract.balanceOf(user4.address);
            const user4ETHBalance = user4ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4USDTBalance.add(user4ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw in other order", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user4).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            const expectedShares2 = amount.mul(usdChainLinkPrice).add("46265780644161037891073611"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(usdChainLinkPrice).add("41239428361799867549678997"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(usdChainLinkPrice).add("26973822631336701195634853"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user4).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user2).withdraw();

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4USDTBalance = await USDTContract.balanceOf(user4.address);
            const user4ETHBalanceInETH = await ETHContract.balanceOf(user4.address);
            const user4ETHBalance = user4ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4USDTBalance.add(user4ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("2"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user3ETHBalanceInETH = await ETHContract.balanceOf(user3.address);
            const user3ETHBalance = user3ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3USDTBalance.add(user3ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("2"));

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user2ETHBalanceInETH = await ETHContract.balanceOf(user2.address);
            const user2ETHBalance = user2ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2USDTBalance.add(user2ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity, and withdraw will close position, so we can deposit and add liquidity again", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await PositionManagerDistributor.connect(user1).withdraw();

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(0);

            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares2 = amount.mul(usdChainLinkPrice);

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);
        });

        it("Should add and remove liquidity 10 times, then withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            for (let i = 0; i < 10; i++) {
                await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
                expect(await ETHContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

                await PositionManager.connect(manager).removeLiquidity();

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("10"));
            }

            // Lose max 6 USDT in 10 add/remove liquidity
            await PositionManagerDistributor.connect(user1).withdraw();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.closeTo(amount, ethers.utils.parseEther("9"));
        });

        it("Should set a deposit fee and charge it in a deposit", async function () {
            const amount = ethers.utils.parseEther("1000");

            const amountAfterFee = amount.mul(900000).div(1000000);

            const amountCharged = amount.sub(amountAfterFee);

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManager.connect(manager).setFee(100000, user2.address);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amountAfterFee);

            expect(await PositionManager.balanceOf(user1.address)).to.be.closeTo(amountAfterFee.mul(usdChainLinkPrice), ethers.utils.parseEther("1"));

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            expect(user1USDTBalance).to.be.equal(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            expect(user2USDTBalance).to.be.equal(amountCharged);
        });

        it("revert: fails to distribute rewards if the contract has no balance", async function () {
            await expect(PositionManager.distributeRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("should distribute to the fundsDistributor (zero users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(amount.mul("1000000000000000000").div(wbnbToUsdt), ethers.utils.parseEther("0.01"));
        });

        it("an user deposits and distributeRewards is called", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);
            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(amount.sub(expectedFundsDistributorBalance));
        });

        it("revert: an user cannot collect rewards if the contract has no balance", async function () {
            await expect(PositionManagerDistributor.connect(user1).collectRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("an user deposits, distributeRewards is called and the user collects rewards", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            await PositionManagerDistributor.connect(user1).collectRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const expectedUser1USDTBalance = amount.sub(expectedFundsDistributorBalance);

            expect(user1USDTBalance).to.be.equal(expectedUser1USDTBalance);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const PositionManagerDistributorBalance = await USDTContract.balanceOf(PositionManagerDistributor.address);

            expect(PositionManagerDistributorBalance).to.be.equal(0);
        });

        it("4 users deposit differents amounts and distributeRewards is called", async function () {
            const amount1 = ethers.utils.parseEther("500");
            const amount2 = ethers.utils.parseEther("1000");
            const amount3 = ethers.utils.parseEther("1500");
            const amount4 = ethers.utils.parseEther("2000");

            await USDTContract.connect(deployer).transfer(user1.address, amount1);
            await USDTContract.connect(deployer).transfer(user2.address, amount2);
            await USDTContract.connect(deployer).transfer(user3.address, amount3);
            await USDTContract.connect(deployer).transfer(user4.address, amount4);

            await USDTContract.connect(user1).approve(PositionManager.address, amount1);
            await USDTContract.connect(user2).approve(PositionManager.address, amount2);
            await USDTContract.connect(user3).approve(PositionManager.address, amount3);
            await USDTContract.connect(user4).approve(PositionManager.address, amount4);

            await PositionManagerDistributor.connect(user1).deposit(amount1);
            await PositionManagerDistributor.connect(user2).deposit(amount2);
            await PositionManagerDistributor.connect(user3).deposit(amount3);
            await PositionManagerDistributor.connect(user4).deposit(amount4);

            const totalAmount = amount1.add(amount2).add(amount3).add(amount4);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, totalAmount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user4USDTBalance = await USDTContract.balanceOf(user4.address);

            expect(user1USDTBalance).to.be.equal(0);
            expect(user2USDTBalance).to.be.equal(0);
            expect(user3USDTBalance).to.be.equal(0);
            expect(user4USDTBalance).to.be.equal(0);

            const expectedFundsDistributorBalance = totalAmount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.01")
            );

            const expectedFundsDistributorBalanceUser1 = amount1.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser2 = amount2.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser3 = amount3.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser4 = amount4.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);
            const user2ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user2.address);
            const user3ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user3.address);
            const user4ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user4.address);

            const expectedUser1USDTBalance = amount1.sub(expectedFundsDistributorBalanceUser1);
            const expectedUser2USDTBalance = amount2.sub(expectedFundsDistributorBalanceUser2);
            const expectedUser3USDTBalance = amount3.sub(expectedFundsDistributorBalanceUser3);
            const expectedUser4USDTBalance = amount4.sub(expectedFundsDistributorBalanceUser4);

            expect(user1ContractUSDTBalance).to.be.equal(expectedUser1USDTBalance);
            expect(user2ContractUSDTBalance).to.be.equal(expectedUser2USDTBalance);
            expect(user3ContractUSDTBalance).to.be.equal(expectedUser3USDTBalance);
            expect(user4ContractUSDTBalance).to.be.equal(expectedUser4USDTBalance);
        });
    });

    describe("PositionManager ETH/WBNB", function () {
        let snap: string;
        let FundsDistributor: any;
        let PositionManagerDistributor: PositionManagerDistributor;
        let PositionManager: any;

        let deployer: SignerWithAddress;
        let manager: SignerWithAddress;
        let user1: SignerWithAddress;
        let user2: SignerWithAddress;
        let user3: SignerWithAddress;
        let user4: SignerWithAddress;

        let USDTAddress = "0x55d398326f99059fF775485246999027B3197955";
        let WBNBAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
        let ETHAddress = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";

        let USDTContract: IERC20;
        let WBNBContract: IERC20;
        let ETHContract: IERC20;

        const ethToUsdt: BigNumber = ethers.utils.parseEther("3359"); // 1 ETH = 3359 USDT
        const wbnbToUsdt: BigNumber = ethers.utils.parseEther("615.40830210"); // 1 WBNB = 615.40830210 USDT

        const bnbChainLinkPrice: BigNumber = BigNumber.from(61540830210); // 61540830210 USDT

        const minTick: BigNumber = BigNumber.from(-887270);
        const maxTick: BigNumber = BigNumber.from(887270);

        const maxPercentage = 1000000;

        let RouterAddress = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

        before(async function () {
            await deployments.fixture(["PositionManagerDistributor"]);

            PositionManagerDistributor = await ethers.getContract("PositionManagerDistributor_3");

            [deployer, manager, user1, user2, user3, user4, FundsDistributor] = await ethers.getSigners();

            const PositionManagerAddress = await PositionManagerDistributor.positionManager();

            PositionManager = await ethers.getContractAt("PositionManager", PositionManagerAddress);

            await PositionManager.setFundsDistributor(FundsDistributor.address, allPercentages.FundsDistributorPercentage);

            USDTContract = (await ethers.getContractAt("IERC20", USDTAddress)) as IERC20;
            WBNBContract = (await ethers.getContractAt("IERC20", WBNBAddress)) as IERC20;
            ETHContract = (await ethers.getContractAt("IERC20", ETHAddress)) as IERC20;

            await PositionManager.connect(deployer).grantRole(Roles.POSITION_MANAGER_ROLE, manager.address);

            const holderAddress = "0x98cF4F4B03a4e967D54a3d0aeC9fCA90851f2Cca";

            await hre.network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [holderAddress],
            });

            await deployer.sendTransaction({
                to: holderAddress,
                value: ethers.utils.parseEther("1"), // Send 1 BNB
            });

            // Get the holder signer
            const holderSigner = await ethers.getSigner(holderAddress);

            // Send 10000 USDT to the deployer
            await USDTContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("10000", "18"));

            // Send 300 ETH to the deployer
            await ETHContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("300", "18"));

            // Send 5000 WBNB to the deployer
            await WBNBContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("5000", "18"));

            // Stop impersonating the holder address
            await hre.network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [holderAddress],
            });
        });

        beforeEach(async function () {
            snap = await ethers.provider.send("evm_snapshot", []);
        });

        afterEach(async function () {
            await ethers.provider.send("evm_revert", [snap]);
        });

        it("Should deposit USDT into Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(expectedShares);
        });

        it("Should deposit and withdraw USDT from Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should manager add liquidity to the pool", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);
            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
        });

        it("Should user deposit USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(bnbChainLinkPrice).add("939241085171666103995718024"); // This value is added manually but after checking that is an acceptable value

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(amount.mul(bnbChainLinkPrice).add(expectedShares));
        });

        it("Should user withdraw USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should two users deposit USDT, then add liquidity and user1 withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount.mul(2));

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.5"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user2).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user2.address, expectedShares);

            const user2NewBalance = await PositionManager.balanceOf(user2.address);

            expect(user2NewBalance).to.be.eq(0);

            const user1Balance = await PositionManager.balanceOf(user1.address);

            expect(user1Balance).to.be.eq(expectedShares);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const user1NewBalance = await PositionManager.balanceOf(user1.address);

            expect(user1NewBalance).to.be.eq(0);
        });

        it("Should deposit and add liquidity with different tick values (in range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-64000, -63000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (under range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-65000, -64000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (over range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-62000, -61000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity and remove liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            await PositionManager.connect(manager).removeLiquidity();

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("1"));
        });

        it("Should deposit 3 times (different users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user4).deposit(amount);

            const expectedShares2 = amount.mul(bnbChainLinkPrice).add("939241085171666103995718024"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(bnbChainLinkPrice).sub("9302294044261730255999749338"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(bnbChainLinkPrice).sub("20193248718388340843878134868"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user2).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user4).withdraw();

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2WBNBBalanceInWBNB = await WBNBContract.balanceOf(user2.address);
            const user2WBNBBalance = user2WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            const user2ETHBalanceInETH = await ETHContract.balanceOf(user2.address);
            const user2ETHBalance = user2ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2WBNBBalance.add(user2ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3WBNBBalanceInWBNB = await WBNBContract.balanceOf(user3.address);
            const user3WBNBBalance = user3WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            const user3ETHBalanceInETH = await ETHContract.balanceOf(user3.address);
            const user3ETHBalance = user3ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3WBNBBalance.add(user3ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4WBNBBalanceInWBNB = await WBNBContract.balanceOf(user4.address);
            const user4WBNBBalance = user4WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            const user4ETHBalanceInETH = await ETHContract.balanceOf(user4.address);
            const user4ETHBalance = user4ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4WBNBBalance.add(user4ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw in other order", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user4).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            const expectedShares2 = amount.mul(bnbChainLinkPrice).sub("20193248718388340843878134868"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(bnbChainLinkPrice).sub("9302294044261730255999749338"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(bnbChainLinkPrice).add("939241085171666103995718024"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user4).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user2).withdraw();

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4WBNBBalanceInWBNB = await WBNBContract.balanceOf(user4.address);
            const user4WBNBBalance = user4WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            const user4ETHBalanceInETH = await ETHContract.balanceOf(user4.address);
            const user4ETHBalance = user4ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4WBNBBalance.add(user4ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3WBNBBalanceInWBNB = await WBNBContract.balanceOf(user3.address);
            const user3WBNBBalance = user3WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            const user3ETHBalanceInETH = await ETHContract.balanceOf(user3.address);
            const user3ETHBalance = user3ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3WBNBBalance.add(user3ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2WBNBBalanceInWBNB = await WBNBContract.balanceOf(user2.address);
            const user2WBNBBalance = user2WBNBBalanceInWBNB.mul(wbnbToUsdt).div(BigNumber.from(10).pow(18));
            const user2ETHBalanceInETH = await ETHContract.balanceOf(user2.address);
            const user2ETHBalance = user2ETHBalanceInETH.mul(ethToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2WBNBBalance.add(user2ETHBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity, and withdraw will close position, so we can deposit and add liquidity again", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.equal(0);

            const expectedShares = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await PositionManagerDistributor.connect(user1).withdraw();

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(0);

            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.2"));
            expect(await ETHContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares2 = amount.mul(bnbChainLinkPrice);

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);
        });

        it("Should add and remove liquidity 10 times, then withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            for (let i = 0; i < 10; i++) {
                await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.3"));
                expect(await ETHContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

                await PositionManager.connect(manager).removeLiquidity();

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("13"));
            }

            // Lose max 6 USDT in 10 add/remove liquidity
            await PositionManagerDistributor.connect(user1).withdraw();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.closeTo(amount, ethers.utils.parseEther("13"));
        });

        it("Should set a deposit fee and charge it in a deposit", async function () {
            const amount = ethers.utils.parseEther("1000");

            const amountAfterFee = amount.mul(900000).div(1000000);

            const amountCharged = amount.sub(amountAfterFee);

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManager.connect(manager).setFee(100000, user2.address);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amountAfterFee);

            expect(await PositionManager.balanceOf(user1.address)).to.be.closeTo(amountAfterFee.mul(bnbChainLinkPrice), ethers.utils.parseEther("1"));

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            expect(user1USDTBalance).to.be.equal(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            expect(user2USDTBalance).to.be.equal(amountCharged);
        });

        it("revert: fails to distribute rewards if the contract has no balance", async function () {
            await expect(PositionManager.distributeRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("should distribute to the fundsDistributor (zero users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(amount.mul("1000000000000000000").div(wbnbToUsdt), ethers.utils.parseEther("0.01"));
        });

        it("an user deposits and distributeRewards is called", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);
            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(amount.sub(expectedFundsDistributorBalance));
        });

        it("revert: an user cannot collect rewards if the contract has no balance", async function () {
            await expect(PositionManagerDistributor.connect(user1).collectRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("an user deposits, distributeRewards is called and the user collects rewards", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            await PositionManagerDistributor.connect(user1).collectRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const expectedUser1USDTBalance = amount.sub(expectedFundsDistributorBalance);

            expect(user1USDTBalance).to.be.equal(expectedUser1USDTBalance);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const PositionManagerDistributorBalance = await USDTContract.balanceOf(PositionManagerDistributor.address);

            expect(PositionManagerDistributorBalance).to.be.equal(0);
        });

        it("4 users deposit differents amounts and distributeRewards is called", async function () {
            const amount1 = ethers.utils.parseEther("500");
            const amount2 = ethers.utils.parseEther("1000");
            const amount3 = ethers.utils.parseEther("1500");
            const amount4 = ethers.utils.parseEther("2000");

            await USDTContract.connect(deployer).transfer(user1.address, amount1);
            await USDTContract.connect(deployer).transfer(user2.address, amount2);
            await USDTContract.connect(deployer).transfer(user3.address, amount3);
            await USDTContract.connect(deployer).transfer(user4.address, amount4);

            await USDTContract.connect(user1).approve(PositionManager.address, amount1);
            await USDTContract.connect(user2).approve(PositionManager.address, amount2);
            await USDTContract.connect(user3).approve(PositionManager.address, amount3);
            await USDTContract.connect(user4).approve(PositionManager.address, amount4);

            await PositionManagerDistributor.connect(user1).deposit(amount1);
            await PositionManagerDistributor.connect(user2).deposit(amount2);
            await PositionManagerDistributor.connect(user3).deposit(amount3);
            await PositionManagerDistributor.connect(user4).deposit(amount4);

            const totalAmount = amount1.add(amount2).add(amount3).add(amount4);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, totalAmount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user4USDTBalance = await USDTContract.balanceOf(user4.address);

            expect(user1USDTBalance).to.be.equal(0);
            expect(user2USDTBalance).to.be.equal(0);
            expect(user3USDTBalance).to.be.equal(0);
            expect(user4USDTBalance).to.be.equal(0);

            const expectedFundsDistributorBalance = totalAmount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.01")
            );

            const expectedFundsDistributorBalanceUser1 = amount1.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser2 = amount2.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser3 = amount3.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser4 = amount4.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);
            const user2ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user2.address);
            const user3ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user3.address);
            const user4ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user4.address);

            const expectedUser1USDTBalance = amount1.sub(expectedFundsDistributorBalanceUser1);
            const expectedUser2USDTBalance = amount2.sub(expectedFundsDistributorBalanceUser2);
            const expectedUser3USDTBalance = amount3.sub(expectedFundsDistributorBalanceUser3);
            const expectedUser4USDTBalance = amount4.sub(expectedFundsDistributorBalanceUser4);

            expect(user1ContractUSDTBalance).to.be.equal(expectedUser1USDTBalance);
            expect(user2ContractUSDTBalance).to.be.equal(expectedUser2USDTBalance);
            expect(user3ContractUSDTBalance).to.be.equal(expectedUser3USDTBalance);
            expect(user4ContractUSDTBalance).to.be.equal(expectedUser4USDTBalance);
        });
    });

    describe("PositionManager USDT/BTCB", function () {
        let snap: string;
        let FundsDistributor: any;
        let PositionManagerDistributor: PositionManagerDistributor;
        let PositionManager: any;

        let deployer: SignerWithAddress;
        let manager: SignerWithAddress;
        let user1: SignerWithAddress;
        let user2: SignerWithAddress;
        let user3: SignerWithAddress;
        let user4: SignerWithAddress;

        let USDTAddress = "0x55d398326f99059fF775485246999027B3197955";
        let BTCBAddress = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c";
        let WBNBAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

        let USDTContract: IERC20;
        let BTCBContract: IERC20;
        let WBNBContract: IERC20;

        const btcbToUsdt: BigNumber = ethers.utils.parseEther("92800.0418671");
        const wbnbToUsdt: BigNumber = ethers.utils.parseEther("615.40830210"); // 1 WBNB = 615.40830210 USDT

        const btcbChainLinkPrice: BigNumber = ethers.utils.parseEther("0.000009266215747491");

        const minTick: BigNumber = BigNumber.from(-887270);
        const maxTick: BigNumber = BigNumber.from(887270);

        const maxPercentage = 1000000;

        let RouterAddress = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

        before(async function () {
            await deployments.fixture(["PositionManagerDistributor"]);

            PositionManagerDistributor = await ethers.getContract("PositionManagerDistributor_4");

            [deployer, manager, user1, user2, user3, user4, FundsDistributor] = await ethers.getSigners();

            const PositionManagerAddress = await PositionManagerDistributor.positionManager();

            PositionManager = await ethers.getContractAt("PositionManager", PositionManagerAddress);

            await PositionManager.setFundsDistributor(FundsDistributor.address, allPercentages.FundsDistributorPercentage);

            USDTContract = (await ethers.getContractAt("IERC20", USDTAddress)) as IERC20;
            BTCBContract = (await ethers.getContractAt("IERC20", BTCBAddress)) as IERC20;
            WBNBContract = (await ethers.getContractAt("IERC20", WBNBAddress)) as IERC20;

            await PositionManager.connect(deployer).grantRole(Roles.POSITION_MANAGER_ROLE, manager.address);

            const holderAddress = "0x98cF4F4B03a4e967D54a3d0aeC9fCA90851f2Cca";

            await hre.network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [holderAddress],
            });

            await deployer.sendTransaction({
                to: holderAddress,
                value: ethers.utils.parseEther("1"), // Send 1 BNB
            });

            // Get the holder signer
            const holderSigner = await ethers.getSigner(holderAddress);

            // Send 10000 USDT to the deployer
            await USDTContract.connect(holderSigner).transfer(deployer.address, ethers.utils.parseUnits("10000", "18"));

            // Stop impersonating the holder address
            await hre.network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [holderAddress],
            });
        });

        beforeEach(async function () {
            snap = await ethers.provider.send("evm_snapshot", []);
        });

        afterEach(async function () {
            await ethers.provider.send("evm_revert", [snap]);
        });

        it("Should deposit USDT into Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(btcbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(expectedShares);
        });

        it("Should deposit and withdraw USDT from Position Manager (!inPosition)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            const expectedShares = amount.mul(btcbChainLinkPrice);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should manager add liquidity to the pool", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 200);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));
        });

        it("Should user deposit USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("100");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 300);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(btcbChainLinkPrice).add("203574277566562826511882099618"); // This value is added manually but after checking that is an acceptable value

            await expect(PositionManagerDistributor.connect(user1).deposit(amount))
                .to.emit(PositionManager, "Deposit")
                .withArgs(user1.address, expectedShares, amount);

            const balance = await PositionManager.balanceOf(user1.address);

            expect(balance).to.be.eq(amount.mul(btcbChainLinkPrice).add(expectedShares));
        });

        it("Should user withdraw USDT after adding liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount.mul(2));

            await USDTContract.connect(user1).approve(PositionManager.address, amount.mul(2));

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 200);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(btcbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const newBalance = await PositionManager.balanceOf(user1.address);

            expect(newBalance).to.be.eq(0);
        });

        it("Should two users deposit USDT, then add liquidity and user1 withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount.mul(2));

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 200);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(btcbChainLinkPrice);

            await expect(PositionManagerDistributor.connect(user2).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user2.address, expectedShares);

            const user2NewBalance = await PositionManager.balanceOf(user2.address);

            expect(user2NewBalance).to.be.eq(0);

            const user1Balance = await PositionManager.balanceOf(user1.address);

            expect(user1Balance).to.be.eq(expectedShares);

            await expect(PositionManagerDistributor.connect(user1).withdraw()).to.emit(PositionManager, "Withdraw").withArgs(user1.address, expectedShares);

            const user1NewBalance = await PositionManager.balanceOf(user1.address);

            expect(user1NewBalance).to.be.eq(0);
        });

        it("Should deposit and add liquidity with different tick values (in range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-64000, -63000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 100);

            const expectedShares = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (under range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-65000, -64000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit and add liquidity with different tick values (over range)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(-62000, -61000);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(0);

            const expectedShares = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity and remove liquidity", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 200);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            await PositionManager.connect(manager).removeLiquidity();

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("9"));
        });

        it("Should deposit 3 times (different users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);
            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);
            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);

            const expectedShares = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares);
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw", async function () {
            const amount = ethers.utils.parseEther("100");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 300);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user4).deposit(amount);

            const expectedShares2 = amount.mul(btcbChainLinkPrice).add("203574277566562826511882099618"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(btcbChainLinkPrice).add("288337920536495628237220975334"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(btcbChainLinkPrice).add("333468202649347120558937419079"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user2).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user4).withdraw();

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user2BTCBBalanceInBTCB = await BTCBContract.balanceOf(user2.address);
            const user2BTCBBalance = user2BTCBBalanceInBTCB.mul(btcbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2USDTBalance.add(user2BTCBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user3BTCBBalanceInBTCB = await BTCBContract.balanceOf(user3.address);
            const user3BTCBBalance = user3BTCBBalanceInBTCB.mul(btcbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3USDTBalance.add(user3BTCBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4USDTBalance = await USDTContract.balanceOf(user4.address);
            const user4BTCBBalanceInBTCB = await BTCBContract.balanceOf(user4.address);
            const user4BTCBBalance = user4BTCBBalanceInBTCB.mul(btcbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4USDTBalance.add(user4BTCBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit user1, add liquidity, and then 3 different users deposits and withdraw in other order", async function () {
            const amount = ethers.utils.parseEther("100");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 300);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await USDTContract.connect(deployer).transfer(user2.address, amount);
            await USDTContract.connect(deployer).transfer(user3.address, amount);
            await USDTContract.connect(deployer).transfer(user4.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);
            await USDTContract.connect(user3).approve(PositionManager.address, amount);
            await USDTContract.connect(user4).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user4).deposit(amount);
            await PositionManagerDistributor.connect(user3).deposit(amount);
            await PositionManagerDistributor.connect(user2).deposit(amount);

            const expectedShares2 = amount.mul(btcbChainLinkPrice).add("333468202649347120558937419079"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);

            const expectedShares3 = amount.mul(btcbChainLinkPrice).add("288337920536495628237220975334"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(expectedShares3);

            const expectedShares4 = amount.mul(btcbChainLinkPrice).add("203574277566562826511882099618"); // This value is added manually but after checking that is an acceptable value
            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(expectedShares4);

            await PositionManagerDistributor.connect(user4).withdraw();
            await PositionManagerDistributor.connect(user3).withdraw();
            await PositionManagerDistributor.connect(user2).withdraw();

            expect(await PositionManager.balanceOf(user4.address)).to.be.eq(0);

            const user4USDTBalance = await USDTContract.balanceOf(user4.address);
            const user4BTCBBalanceInBTCB = await BTCBContract.balanceOf(user4.address);
            const user4BTCBBalance = user4BTCBBalanceInBTCB.mul(btcbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user4USDTBalance.add(user4BTCBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user3.address)).to.be.eq(0);

            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user3BTCBBalanceInBTCB = await BTCBContract.balanceOf(user3.address);
            const user3BTCBBalance = user3BTCBBalanceInBTCB.mul(btcbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user3USDTBalance.add(user3BTCBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("1"));

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user2BTCBBalanceInBTCB = await BTCBContract.balanceOf(user2.address);
            const user2BTCBBalance = user2BTCBBalanceInBTCB.mul(btcbToUsdt).div(BigNumber.from(10).pow(18));
            expect(user2USDTBalance.add(user2BTCBBalance)).to.be.closeTo(amount, ethers.utils.parseEther("3"));

            expect(await PositionManager.totalSupply()).to.be.eq(expectedShares);
        });

        it("Should deposit, add liquidity, and withdraw will close position, so we can deposit and add liquidity again", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 200);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(expectedShares);

            await PositionManagerDistributor.connect(user1).withdraw();

            expect(await PositionManager.balanceOf(user1.address)).to.be.eq(0);

            await USDTContract.connect(deployer).transfer(user2.address, amount);

            await USDTContract.connect(user2).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user2).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, 300);
            expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

            const expectedShares2 = amount.mul(btcbChainLinkPrice);

            expect(await PositionManager.balanceOf(user2.address)).to.be.eq(expectedShares2);
        });

        it("Should add and remove liquidity 10 times, then withdraw", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amount);

            for (let i = 0; i < 10; i++) {
                await PositionManager.connect(manager).addLiquidity(minTick, maxTick);

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.001"));
                expect(await BTCBContract.balanceOf(PositionManager.address)).to.be.closeTo(0, ethers.utils.parseEther("0.0001"));

                await PositionManager.connect(manager).removeLiquidity();

                expect(await USDTContract.balanceOf(PositionManager.address)).to.be.closeTo(amount, ethers.utils.parseEther("16"));
            }

            // Lose max 6 USDT in 10 add/remove liquidity
            await PositionManagerDistributor.connect(user1).withdraw();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.closeTo(amount, ethers.utils.parseEther("16"));
        });

        it("Should set a deposit fee and charge it in a deposit", async function () {
            const amount = ethers.utils.parseEther("1000");

            const amountAfterFee = amount.mul(900000).div(1000000);

            const amountCharged = amount.sub(amountAfterFee);

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManager.connect(manager).setFee(100000, user2.address);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            expect(await USDTContract.balanceOf(PositionManager.address)).to.be.eq(amountAfterFee);

            expect(await PositionManager.balanceOf(user1.address)).to.be.closeTo(
                amountAfterFee.mul(btcbChainLinkPrice),
                ethers.utils.parseEther("100000000000000")
            );

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            expect(user1USDTBalance).to.be.equal(0);

            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            expect(user2USDTBalance).to.be.equal(amountCharged);
        });

        it("revert: fails to distribute rewards if the contract has no balance", async function () {
            await expect(PositionManager.distributeRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("should distribute to the fundsDistributor (zero users)", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(amount.mul("1000000000000000000").div(wbnbToUsdt), ethers.utils.parseEther("0.01"));
        });

        it("an user deposits and distributeRewards is called", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            expect(user1USDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);
            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(amount.sub(expectedFundsDistributorBalance));
        });

        it("revert: an user cannot collect rewards if the contract has no balance", async function () {
            await expect(PositionManagerDistributor.connect(user1).collectRewards()).to.be.revertedWith("InvalidEntry");
        });

        it("an user deposits, distributeRewards is called and the user collects rewards", async function () {
            const amount = ethers.utils.parseEther("1000");

            await USDTContract.connect(deployer).transfer(user1.address, amount);

            await USDTContract.connect(user1).approve(PositionManager.address, amount);

            await PositionManagerDistributor.connect(user1).deposit(amount);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, amount);

            await PositionManager.connect(manager).distributeRewards();

            await PositionManagerDistributor.connect(user1).collectRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);

            const expectedFundsDistributorBalance = amount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const expectedUser1USDTBalance = amount.sub(expectedFundsDistributorBalance);

            expect(user1USDTBalance).to.be.equal(expectedUser1USDTBalance);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);

            expect(user1ContractUSDTBalance).to.be.equal(0);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.001")
            );

            const PositionManagerDistributorBalance = await USDTContract.balanceOf(PositionManagerDistributor.address);

            expect(PositionManagerDistributorBalance).to.be.equal(0);
        });

        it("4 users deposit differents amounts and distributeRewards is called", async function () {
            const amount1 = ethers.utils.parseEther("500");
            const amount2 = ethers.utils.parseEther("1000");
            const amount3 = ethers.utils.parseEther("1500");
            const amount4 = ethers.utils.parseEther("2000");

            await USDTContract.connect(deployer).transfer(user1.address, amount1);
            await USDTContract.connect(deployer).transfer(user2.address, amount2);
            await USDTContract.connect(deployer).transfer(user3.address, amount3);
            await USDTContract.connect(deployer).transfer(user4.address, amount4);

            await USDTContract.connect(user1).approve(PositionManager.address, amount1);
            await USDTContract.connect(user2).approve(PositionManager.address, amount2);
            await USDTContract.connect(user3).approve(PositionManager.address, amount3);
            await USDTContract.connect(user4).approve(PositionManager.address, amount4);

            await PositionManagerDistributor.connect(user1).deposit(amount1);
            await PositionManagerDistributor.connect(user2).deposit(amount2);
            await PositionManagerDistributor.connect(user3).deposit(amount3);
            await PositionManagerDistributor.connect(user4).deposit(amount4);

            const totalAmount = amount1.add(amount2).add(amount3).add(amount4);

            await USDTContract.connect(deployer).transfer(PositionManagerDistributor.address, totalAmount);

            await PositionManager.connect(manager).distributeRewards();

            const user1USDTBalance = await USDTContract.balanceOf(user1.address);
            const user2USDTBalance = await USDTContract.balanceOf(user2.address);
            const user3USDTBalance = await USDTContract.balanceOf(user3.address);
            const user4USDTBalance = await USDTContract.balanceOf(user4.address);

            expect(user1USDTBalance).to.be.equal(0);
            expect(user2USDTBalance).to.be.equal(0);
            expect(user3USDTBalance).to.be.equal(0);
            expect(user4USDTBalance).to.be.equal(0);

            const expectedFundsDistributorBalance = totalAmount.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const FundsDistributorBalance = await WBNBContract.balanceOf(FundsDistributor.address);

            expect(FundsDistributorBalance).to.be.closeTo(
                expectedFundsDistributorBalance.mul("1000000000000000000").div(wbnbToUsdt),
                ethers.utils.parseEther("0.01")
            );

            const expectedFundsDistributorBalanceUser1 = amount1.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser2 = amount2.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser3 = amount3.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);
            const expectedFundsDistributorBalanceUser4 = amount4.mul(allPercentages.FundsDistributorPercentage).div(maxPercentage);

            const user1ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user1.address);
            const user2ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user2.address);
            const user3ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user3.address);
            const user4ContractUSDTBalance = await PositionManagerDistributor.balanceOf(user4.address);

            const expectedUser1USDTBalance = amount1.sub(expectedFundsDistributorBalanceUser1);
            const expectedUser2USDTBalance = amount2.sub(expectedFundsDistributorBalanceUser2);
            const expectedUser3USDTBalance = amount3.sub(expectedFundsDistributorBalanceUser3);
            const expectedUser4USDTBalance = amount4.sub(expectedFundsDistributorBalanceUser4);

            expect(user1ContractUSDTBalance).to.be.equal(expectedUser1USDTBalance);
            expect(user2ContractUSDTBalance).to.be.equal(expectedUser2USDTBalance);
            expect(user3ContractUSDTBalance).to.be.equal(expectedUser3USDTBalance);
            expect(user4ContractUSDTBalance).to.be.equal(expectedUser4USDTBalance);
        });
    });
}
