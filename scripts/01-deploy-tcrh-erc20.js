const { network, ethers } = require("hardhat");
const { set, load } = require("../lib/state.js");

async function main() {
  console.log("Network:", network.name);
  console.log("Network config:", network.config);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "Native");

  // 读取已有 verifier / hasher
  const hasherAddress = load(network.name)?.hasher;
  const verifierAddress = load(network.name)?.verifier;
  if (!hasherAddress || !verifierAddress) {
    throw new Error(`state.json 缺少 hasher/verifier，先跑 02 和 01 主脚本。hasher: ${hasherAddress}, verifier: ${verifierAddress}`);
  }
  console.log("Using hasher:", hasherAddress);
  console.log("Using verifier:", verifierAddress);

  // ERC20 配置
  const erc20TokenAddress = process.env.ERC20_TOKEN_ADDRESS || '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'; //DAI
  const erc20Decimals = process.env.ERC20_DECIMALS
    ? Number(process.env.ERC20_DECIMALS)
    : 18;
  const erc20DenominationEnv = process.env.ERC20_DENOMINATION || "1";

  if (!erc20TokenAddress) {
    throw new Error("未提供 ERC20_TOKEN_ADDRESS 环境变量");
  }

  console.log("\n=== Deploying ERC20Tornado ===");
  console.log("Token:", erc20TokenAddress);
  console.log("Decimals:", erc20Decimals);
  console.log("Denomination:", erc20DenominationEnv);

  const ERC20Tornado = await ethers.getContractFactory("ERC20Tornado");
  const erc20Denomination = ethers.utils.parseUnits(
    erc20DenominationEnv,
    erc20Decimals
  );

  const erc20Mixer = await ERC20Tornado.deploy(
    verifierAddress,
    hasherAddress,
    erc20Denomination,
    20,
    erc20TokenAddress
  );
  console.log("ERC20Tornado deploy tx:", erc20Mixer.deployTransaction.hash);
  const deployReceipt = await erc20Mixer.deployTransaction.wait();
  const deployedBlockNumber = deployReceipt.blockNumber;
  await erc20Mixer.deployed();
  const erc20MixerAddress = erc20Mixer.address;
  console.log("ERC20 mixer deployed to:", erc20MixerAddress);
  console.log("Deployed at block number:", deployedBlockNumber);

  set(network.name, "1DAI", erc20MixerAddress);

  console.log("\n=== Deployment Summary ===");
  console.log({
    network: network.name,
    verifier: verifierAddress,
    hasher: hasherAddress,
    mixerERC20: erc20MixerAddress,
    denomination: erc20DenominationEnv,
    decimals: erc20Decimals,
    token: erc20TokenAddress,
  });
}

main()
  .then(() => {
    console.log("\n=== Deployment Completed Successfully ===");
  })
  .catch((error) => {
    console.error("\n=== Deployment Failed ===");
    console.error(error);
    process.exit(1);
  });
