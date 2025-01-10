import * as dotenv from "dotenv";

dotenv.config();

export const Salt= process.env.SALT || "...";

export const Roles: any = {
    DEFAULT_ADMIN_ROLE: "0x0000000000000000000000000000000000000000000000000000000000000000",
    MANAGER_ROLE: "0xc8d10dde7c0d5edaef1d230c23741b217e794f58f0ca18bc9ea47be8f3bd5cb3",
    POSITION_MANAGER_ROLE: "0xf33d40e6c84e251a3e1cff80c569d5646a4f006b85649b53b993dadc59eb3748"
};

export const contractAddresses: any = {
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    SUSDT: "0x29e38769f23701A2e4A8Ef0492e19dA4604Be62c",
    WMATIC : "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",

    SwapRouter : "0xE592427A0AEce92De3Edee1F18E0157C05861564",

    StargateRouter: "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd",
    VaultSUSDT : "0xaD8cB7Fd5db3e757C0f9e5A1353D8E64E2FA12A6",

    // UniSwap
    XUSDC_USDT: "0x8c6FE430cf06e56BE7c092AD3A249BF0BcB388B9",
    VaultXUSDC_USDT: "0x6255becF55e6821455BA519A687993BB4c2C78BA",

    XUSDC_WETH: "0x1Fd452156b12FB5D74680C5Ff166303E6dd12A78",
    VaultXUSDC_WETH: "0xC97D24C80653f0E15C3238DC3730AB20eae03F4D",

    XWMATIC_USDC: "0xE583b04b9a8F576aa7F17ECc6eB662499B5A8793",
    VaultXWMATIC_USDC: "0x52dAa2D58963c8B9a2cB38b2f2369bd981Dfb33e",

    // QuickSwap
    AWETH_USDT: "0x5928f9f61902b139e1c40cBa59077516734ff09f",
    VaultAWETH_USDT: "0x8CaA1a3809b3C67C61Eaf5524e1cB784ED6bA8B3",

    AUSDC_WETH: "0x3974FbDC22741A1632E024192111107b202F214f",
    VaultAUSDC_WETH: "0x0514335D86463544220CBa8ca83B675AbD624525",

    AWMATIC_USDT: "0x598cA33b7F5FAB560ddC8E76D94A4b4AA52566d7",
    VaultAWMATIC_USDT: "0xC2a4c0682f32734cC75eB3eCC02ba6C9A546E836",

    // VaultAUSDC_DAI:"0x9F44818938DfD1DD65332D943179274880379566",
    // VaultAWETH_AAVE:"0x4FBDA999B5b90b9AB92a7C62b9Ce670Ffe6BDb39",
    // VaultAWBTC_WETH:"0x173587a9e2Bb29244418Eca0537F059ec24963bC",
    // VaultAWBTC_WETH_WIDE:"0xa7C8A216640b9C8a441aBECa29947B45216E776A",

    VaultCLMWBTC_USDCe: "0x71d38eec002e65ec38343c44b2aaed707ed56027",
    
    VaultCLMWETH_USDCe: "0xa55eEB0b0ef32Bf25425C2107350b07E1e8e1346",

    VaultCLMWBTC_WETH: "0x081901d477A296CDDE2084697c25Cfd52805BA31",

    UniProxy: "0x48975Ea6aA25914927241C3A9F493BfEEb8CA591",

    UniProxyQuickSwap: "0xA42d55074869491D60Ac05490376B74cF19B00e6",

    // R2RWallet : "0x711b4049Ba402A93d71602407850BCEc9D53dFc6", // POL
    R2RWallet : "0x2F764e19d71904EE6dD89Df47117Dcdf6dbB8d82", // BSC
    // Admin: "0xAb2ea29E54740aa3Fd66821700Cb096C9bEfA2a0", // POL
    Admin: "0x43c12678434DBEcE2C013008810dDf3a561C0cef", // BSC
};

export const allPercentages: any = {
    refereePercentages: [
        227272, // 22.7272%
        136363, // 13.6363%
        136363, // 13.6363%
        90909, // 9.0909%
        90909, // 9.0909%
        45454, // 4.5454%
        45454, // 4.5454%
        45454, // 4.5454%
        45454, // 4.5454%
        45454, // 4.5454%
    ],
    r2rWalletPercentage: 393939, // 39.3939%
    FundsDistributorPercentage: 300000, // 30%
};

export const InitValues_ReferralManager: any = {
    _admin: contractAddresses["Admin"],
    _percentages: allPercentages["refereePercentages"],
    _r2rWalletPercentage: allPercentages["r2rWalletPercentage"],
    _r2rWallet: contractAddresses["R2RWallet"],
};

export const InitValues_FundsDistributor: any = {
    _swapRouter: contractAddresses["SwapRouter"],
    _usdt: contractAddresses["USDT"],
    _wmatic: contractAddresses["WMATIC"],
};
