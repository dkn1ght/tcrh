// 同步鏈上 Merkle 樹到本地文件，基於 Deposit 事件重放
// 用法示例：
// MIXER_TYPE=erc20 START_BLOCK=71947514 npx hardhat run --network bsc scripts/06-sync-merkle-from-chain.js
// npx hardhat run --network bsc scripts/06-sync-merkle-from-chain.js -- --type erc20 --start-block 0 --chunk-size 40000
// 參數：
//   --type=eth|erc20        默認 eth
//   --start-block=<number>   默認 0，建議填部署區塊以減少查詢量
//   --chunk-size=<number>    單次事件查詢區塊跨度，默認 50000 或 ENV EVENT_CHUNK_SIZE
// 環境變量：
//   MERKLE_TREE_FILE / MERKLE_TREE_FILE_ERC20 / MERKLE_TREE_FILE_ETH 指定輸出的本地樹文件
//   EVENT_CHUNK_SIZE 指定查詢跨度
//
// 會輸出本地根並與鏈上 getLastRoot 比對

const { ethers, network } = require("hardhat");
const path = require("path");
const { load } = require("../lib/state");
const {
  createFileMerkleTreeClient,
} = require("../forge-ffi-scripts/merkleTreeFile.js");

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const prefix = `--${name}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    if (!hit) return def;
    return hit.slice(prefix.length);
  };
  const type = (
    get("type", process.env.MIXER_TYPE || "eth") || "eth"
  ).toLowerCase();
  const startBlockRaw = get("start-block", process.env.START_BLOCK);
  const startBlock = startBlockRaw !== undefined ? Number(startBlockRaw) : 0;
  const chunkRaw = get("chunk-size", process.env.EVENT_CHUNK_SIZE || 50000);
  const chunkSize = Number(chunkRaw);
  if (!["eth", "erc20"].includes(type)) {
    throw new Error(`--type 只能是 eth 或 erc20，收到 ${type}`);
  }
  if (Number.isNaN(startBlock) || startBlock < 0) {
    throw new Error(`--start-block 非法：${startBlockRaw}`);
  }
  if (Number.isNaN(chunkSize) || chunkSize <= 0) {
    throw new Error(`--chunk-size 非法：${chunkRaw}`);
  }
  return { type, startBlock, chunkSize };
}

async function main() {
  const { type, startBlock, chunkSize } = parseArgs();
  console.log("Network:", network.name);
  console.log("Mode:", type);
  console.log("Start block:", startBlock);
  console.log("Chunk size:", chunkSize);

  let networkName = network.name;
  if (networkName === "unknown" && network.name === "localhost") {
    networkName = "localhost";
  }

  const addresses = load(networkName);
  const mixerAddress =
    type === "erc20" ? addresses.mixerERC20 : addresses.mixer;

  if (!mixerAddress) {
    throw new Error(
      `state.json 缺少 ${
        type === "erc20" ? "mixerERC20" : "mixer"
      } 地址，網絡: ${networkName}`
    );
  }

  const artifact =
    type === "erc20"
      ? require("../contracts/abi/ERC20Tornado.json")
      : require("../contracts/abi/ETHTornado.json");
  const abi = artifact.abi || artifact;

  const provider = ethers.provider;
  const mixer = new ethers.Contract(mixerAddress, abi, provider);

  const levels = await mixer.levels();
  console.log("Merkle tree levels:", levels.toString());

  // 確定本地文件路徑
  const envFile =
    process.env.MERKLE_TREE_FILE ||
    (type === "erc20"
      ? process.env.MERKLE_TREE_FILE_ERC20
      : process.env.MERKLE_TREE_FILE_ETH);
  const filePath =
    envFile ||
    (type === "erc20"
      ? "merkle-tree-data-erc20.json"
      : "merkle-tree-data.json");
  console.log("Local tree file:", filePath);

  // 1) 查詢 Deposit 事件
  console.log("\n=== Fetching Deposit events ===");
  const filter = mixer.filters.Deposit();
  const latestBlock = await provider.getBlockNumber();
  const events = [];

  for (let from = startBlock; from <= latestBlock; from += chunkSize) {
    console.log("filter=>", filter);
    const to = Math.min(from + chunkSize - 1, latestBlock);
    const chunk = await mixer.queryFilter(filter, from, to);
    events.push(...chunk);
    console.log(
      `Fetched ${chunk.length} events in block range [${from}, ${to}]`
    );
  }

  console.log("Total deposits fetched:", events.length);

  // 2) 按 leafIndex 排序，防止亂序
  const sorted = events.sort(
    (a, b) => a.args.leafIndex.toNumber() - b.args.leafIndex.toNumber()
  );

  // 3) 重建本地樹
  const tree = await createFileMerkleTreeClient({
    depth: Number(levels),
    filePath,
  });
  await tree.reset();

  for (const ev of sorted) {
    await tree.addLeaf(ev.args.commitment);
  }

  const stats = tree.getTreeStats();
  console.log("Rebuilt leaves:", stats.leafCount);
  console.log("Local root:", stats.rootHash);

  // 4) 校驗鏈上根
  const onchainRoot = await mixer.getLastRoot();
  console.log("On-chain root:", onchainRoot);
  const matched = onchainRoot.toLowerCase() === stats.rootHash.toLowerCase();
  console.log("Root match:", matched ? "✅" : "❌");

  if (!matched) {
    console.warn("⚠️ 本地根與鏈上最新根不一致，可能是查詢範圍或樹深配置不正確");
  }

  console.log("\n=== Sync Completed ===");
}

main().catch((err) => {
  console.error("\n=== Sync Failed ===");
  console.error(err);
  process.exit(1);
});
