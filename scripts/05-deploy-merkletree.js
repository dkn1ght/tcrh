const { network, ethers } = require("hardhat");
const { set,load } = require("../lib/state.js");

async function main() {
  console.log("Network:", network.name);
  console.log("Network config:", network.config);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  // 检查账户余额
  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "ETH");

  // 部署 Groth16Verifier
  console.log("\n=== Deploying MerkleTreeWithHistory ===");
  const hasherAddress = await load(network.name)['hasher'];
  const Merkle = await ethers.getContractFactory("MerkleTreeWithHistory");
  const merkle = await Merkle.deploy(
    20,
    hasherAddress
  );
  await merkle.deployed(); // Ethers v5 使用 deployed()
  const merkleAddress = merkle.address; // Ethers v5 直接使用 address 属性
  console.log("Merkle tree deployed to:", merkleAddress);
  
  // 保存 verifier 地址
  set(network.name, "merkle", merkleAddress);

  const addresses = { 
    hasher: hasherAddress, 
    merkle: merkleAddress
  };
  console.log("\n=== Deployment Summary ===");
  console.log("All addresses saved:", addresses);
  
  return addresses;
}

main().then((addresses) => {
  console.log("\n=== Deployment Completed Successfully ===");
  console.log(addresses);
}).catch((error) => {
  console.error("\n=== Deployment Failed ===");
  console.error(error);
  process.exit(1);
});