// lib/state.js
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "addresses.json");

// 确保数据目录存在
const dataDir = path.dirname(FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * 加载指定链的所有合约地址
 * @param {string} chain - 链名称 (如 "localhost", "sepolia", "mainnet")
 * @returns {Object} 合约地址字典 { contractName: address, ... }
 */
function load(chain) {
  if (!fs.existsSync(FILE)) {
    return {};
  }
  
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  return data[chain] || {};
}

/**
 * 设置合约地址
 * @param {string} chainName - 链名称
 * @param {string} contractName - 合约名称
 * @param {string} contractAddress - 合约地址
 */
function set(chainName, contractName, contractAddress) {
  let data = {};
  
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  }
  
  if (!data[chainName]) {
    data[chainName] = {};
  }
  
  data[chainName][contractName] = contractAddress;
  
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  load,
  set
};