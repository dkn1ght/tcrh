const { network, ethers } = require("hardhat");
const { set, load } = require("../lib/state.js");

async function main() {
  console.log("Network:", network.name);
  console.log("Network config:", network.config);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  // 检查账户余额
  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "ETH");

  // 部署 Groth16Verifier
  console.log("\n=== Deploying Groth16Verifier ===");
  const Verifier = await ethers.getContractFactory("Groth16Verifier");
  console.log("Sending Groth16Verifier deployment tx...");
  const verifier = await Verifier.deploy();
  console.log("Verifier deploy tx hash:", verifier.deployTransaction.hash);
  console.log("Waiting for verifier deployment to be mined...");
  await verifier.deployed(); // Ethers v5 使用 deployed()
  const verifierAddress = verifier.address; // Ethers v5 直接使用 address 属性
  console.log("Verifier deployed to:", verifierAddress);

  // 保存 verifier 地址
  set(network.name, "verifier", verifierAddress);

  // hasher 使用现有地址
  const hasherAddress = await load(network.name)["hasher"];
  //   const hasherAddress = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
  //   set("localhost", "hasher", hasherAddress);
  console.log("Using existing hasher at:", hasherAddress);

  // 部署 ETHTornado
  console.log("\n=== Deploying ETHTornado ===");
  const ETHTornado = await ethers.getContractFactory("ETHTornado");

  console.log(verifierAddress, hasherAddress);
  const mixer = await ETHTornado.deploy(
    verifierAddress,
    hasherAddress,
    ethers.utils.parseEther("0.0001"), // Ethers v5 使用 utils.parseEther
    20
  );
  await mixer.deployed(); // Ethers v5 使用 deployed()
  const mixerAddress = mixer.address; // Ethers v5 直接使用 address 属性
  console.log("Mixer deployed to:", mixerAddress);

  // 保存 mixer 地址
  set(network.name, "mixer", mixerAddress);

  const addresses = {
    verifier: verifierAddress,
    hasher: hasherAddress,
    mixer: mixerAddress,
  };
  console.log("\n=== Deployment Summary ===");
  console.log("All addresses saved:", addresses);

  return addresses;
}

main()
  .then((addresses) => {
    console.log("\n=== Deployment Completed Successfully ===");
    console.log(addresses);
  })
  .catch((error) => {
    console.error("\n=== Deployment Failed ===");
    console.error(error);
    process.exit(1);
  });
