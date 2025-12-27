require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

module.exports = {
  solidity: "0.8.28",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    polygon: {
      url: process.env.POL_RPC_URL,
      accounts: [process.env.PRIVATE_KEY].filter(Boolean),
      chainId: 137,
      // gasMultiplier: 1.1,
      // maxFeePerGas: 10_000_000_000_000,
      // maxPriorityFeePerGas: 3_000_000_000_000,
    },
    bsc: {
      url: process.env.BSC_RPC_URL,
      accounts: [process.env.PRIVATE_KEY].filter(Boolean),
      chainId: 56,
    },
  },
};
