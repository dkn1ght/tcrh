const { network, ethers } = require("hardhat");

async function main() {
  console.log("Testing basic deployment...");
  console.log("Network:", network.name);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // 获取账户余额
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.utils.formatEther(balance), "ETH");

  // 部署一个简单的测试合约
  const TestContract = await ethers.getContractFactory("TestContract");
  console.log("Contract factory created");

  try {
    const testContract = await TestContract.deploy();
    await testContract.deployed();
    console.log("Contract deployed to:", testContract.address);
  } catch (error) {
    console.error("Deployment failed:", error.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});