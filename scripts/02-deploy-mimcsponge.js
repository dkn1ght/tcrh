const { network, ethers } = require("hardhat");
const { set,load } = require("../lib/state.js");

async function main() {
  console.log("Network:", network.name);
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // 检查账户余额
  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "ETH");

  // 生成 MimcSponge 字节码
  console.log("Generating MimcSponge bytecode...");
  const circomlibjs = require("circomlibjs");
  const bytecode = circomlibjs.mimcSpongecontract.createCode("mimcsponge", 220);
  
  console.log("Bytecode length:", bytecode.length);
  console.log("Bytecode preview:", bytecode.substring(0, 100) + "...");
  
  try {
    // 估算 gas
    const gasEstimate = await deployer.estimateGas({
      data: bytecode,
    });
    console.log("Estimated gas:", gasEstimate.toString());
    
    // 直接部署字节码，不需要 ABI
    console.log("Deploying contract...");
    const tx = await deployer.sendTransaction({
      data: bytecode,
      gasLimit: gasEstimate.mul(120).div(100), // 增加 20% gas buffer
    });
    
    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    const contractAddress = receipt.contractAddress;
    
    console.log("✅ Contract deployed successfully!");
    console.log("Contract address:", contractAddress);
    console.log("Gas used:", receipt.gasUsed.toString());
    console.log("Transaction fee:", ethers.utils.formatEther(receipt.gasUsed.mul(tx.gasPrice)), "ETH");
    
    set(network.name, "hasher", contractAddress);
    return contractAddress;
    
  } catch (error) {
    console.error("❌ Deployment failed:");
    console.error("Error message:", error.message);
    if (error.data) {
      console.error("Error data:", error.data);
    }
    throw error;
  }
}

main()
  .then((address) => {
    console.log("\n=== Deployment Summary ===");
    console.log("MimcSponge deployed at:", address);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n=== Deployment Failed ===");
    console.error(error);
    process.exit(1);
  });