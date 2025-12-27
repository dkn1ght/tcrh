const { ethers } = require("hardhat");
const circomlib = require('circomlibjs');

// 純內存模擬的 Tornado MerkleTree
class TornadoTree {
    constructor(levels, hasherContract, merkleContract) {
        this.levels = levels;
        this.hasher = hasherContract;
        this.merkleContract = merkleContract;
        this.filledSubtrees = new Array(levels).fill('0x0000000000000000000000000000000000000000000000000000000000000000');
        this.roots = [];
        this.currentRootIndex = 0;
        this.nextIndex = 0;
        this.rootHistorySize = 30;
        
        // 預計算零值
        this.zeros = {};
    }

    // 初始化：設置零值和初始 filledSubtrees
    async init() {
        // 從合約獲取零值
        for (let i = 0; i < this.levels; i++) {
            const zero = await this.getZeroFromContract(i);
            this.zeros[i] = zero;
            this.filledSubtrees[i] = zero;
        }
        
        // 設置初始根
        this.roots[0] = this.zeros[this.levels - 1];
        
        console.log(`TornadoTree 初始化完成: ${this.levels} 層`);
        console.log(`初始根: ${this.roots[0]}`);
    }

    async getZeroFromContract(level) {
        // 這裡你需要替換成實際的合約調用
        const zeros = [
            '0x2fe54c60d3acabf3343a35b6eba15db4821b340f76e741e2249685ed4899af6c',
            '0x256a6135777eee2fd26f54b8b7037a25439d5235caee224154186d2b8a52e31d',
            '0x1151949895e82ab19924de92c40a3d6f7bcb60d92b00504b8199613683f0c200',
            // ... 更多零值
        ];
        
        // 如果有合約，用合約的零值
        if (this.hasher && this.hasher.parent) {
            try {
                const merkleContract = this.hasher.parent;
                return await merkleContract.zeros(level);
            } catch (e) {
                // fallback 到硬編碼值
            }
        }
        
        return zeros[level] || '0x0000000000000000000000000000000000000000000000000000000000000000';
    }

    // MiMC 哈希（使用合約的 hashLeftRight 方法）
    async hashLeftRight(left, right) {
        if (this.merkleContract) {
            // 使用合約的 hashLeftRight 方法
            return await this.merkleContract.hashLeftRight(this.hasher.address, left, right);
        } else {
            // fallback 到本地 circomlib（現在我們知道它是正確的）
            const mimc = await circomlib.buildMimcSponge();
            const l = BigInt(left);
            const r = BigInt(right);
            let elt = mimc.multiHash([l, r], 0n);
            if (Array.isArray(elt)) elt = elt[0];
            const out = mimc.F.toObject(elt);
            return '0x' + out.toString(16).padStart(64, '0');
        }
    }

    // 插入葉子（完全模擬 Tornado 的 _insert 邏輯）
    async insert(leaf) {
        const _nextIndex = this.nextIndex;
        
        if (_nextIndex >= Math.pow(2, this.levels)) {
            throw new Error("Merkle tree is full");
        }
        
        let currentIndex = _nextIndex;
        let currentLevelHash = leaf;
        
        console.log(`\n插入葉子 ${_nextIndex}: ${leaf}`);
        console.log("Tornado _insert 過程:");
        
        for (let i = 0; i < this.levels; i++) {
            let left, right;
            
            if (currentIndex % 2 === 0) {
                // 左子節點
                left = currentLevelHash;
                right = this.zeros[i];
                this.filledSubtrees[i] = currentLevelHash;
                console.log(`Level ${i}: 左=${left.substring(0, 16)}..., 右=zero[${i}], 更新 filledSubtrees[${i}]`);
            } else {
                // 右子節點
                left = this.filledSubtrees[i];
                right = currentLevelHash;
                console.log(`Level ${i}: 左=filledSubtrees[${i}], 右=${right.substring(0, 16)}...`);
            }
            
            currentLevelHash = await this.hashLeftRight(left, right);
            console.log(`  → 計算出: ${currentLevelHash.substring(0, 16)}...`);
            
            currentIndex = Math.floor(currentIndex / 2);
        }
        
        // 更新根歷史
        const newRootIndex = (this.currentRootIndex + 1) % this.rootHistorySize;
        this.currentRootIndex = newRootIndex;
        this.roots[newRootIndex] = currentLevelHash;
        this.nextIndex = _nextIndex + 1;
        
        console.log(`新根: ${currentLevelHash}`);
        console.log(`nextIndex 更新為: ${this.nextIndex}`);
        
        return _nextIndex;
    }

    getLastRoot() {
        return this.roots[this.currentRootIndex];
    }

    // 顯示當前狀態
    showState() {
        console.log("\n=== TornadoTree 狀態 ===");
        console.log(`nextIndex: ${this.nextIndex}`);
        console.log(`當前根: ${this.getLastRoot()}`);
        console.log("filledSubtrees 前5層:");
        for (let i = 0; i < Math.min(5, this.levels); i++) {
            console.log(`  Level ${i}: ${this.filledSubtrees[i]}`);
        }
    }
}

// 測試函數
async function testMemoryVsContract() {
    console.log("=== 內存模擬 vs 合約對比 ===\n");
    
    // 連接合約
    const { load } = require("../lib/state.js");
    const { network } = require("hardhat");
    
    const hasherAddress = await load(network.name)['hasher'];
    const merkleAddress = await load(network.name)['merkle'];
    const [signer] = await ethers.getSigners();
    
    console.log(`從狀態文件讀取地址:`);
    console.log(`Hasher: ${hasherAddress}`);
    console.log(`Merkle: ${merkleAddress}\n`);
    
    const hasherABI = ["function MiMCSponge(uint256 in_xL, uint256 in_xR, uint256 k) external pure returns (uint256 xL, uint256 xR)"];
    const merkleABI = [
        "function levels() external view returns (uint32)",
        "function nextIndex() external view returns (uint32)", 
        "function getLastRoot() external view returns (bytes32)",
        "function zeros(uint256 i) external pure returns (bytes32)",
        "function insert(bytes32 _leaf) external returns (uint32)",
        "function filledSubtrees(uint256) external view returns (bytes32)",
        "function hashLeftRight(address _hasher, bytes32 _left, bytes32 _right) external pure returns (bytes32)"
    ];
    
    const hasher = new ethers.Contract(hasherAddress, hasherABI, signer);
    const merkle = new ethers.Contract(merkleAddress, merkleABI, signer);
    
    // 創建內存樹
    const levels = await merkle.levels();
    const memoryTree = new TornadoTree(levels, hasher, merkle);
    
    // 從合約獲取零值來初始化內存樹
    for (let i = 0; i < levels; i++) {
        const zero = await merkle.zeros(i);
        memoryTree.zeros[i] = zero;
        memoryTree.filledSubtrees[i] = zero;
    }
    memoryTree.roots[0] = memoryTree.zeros[levels - 1];
    
    console.log("1. 初始狀態對比:");
    const contractInitialRoot = await merkle.getLastRoot();
    const memoryInitialRoot = memoryTree.getLastRoot();
    console.log(`合約初始根: ${contractInitialRoot}`);
    console.log(`內存初始根: ${memoryInitialRoot}`);
    console.log(`初始根匹配: ${contractInitialRoot === memoryInitialRoot ? '✅' : '❌'}\n`);
    
    // 測試插入（20個葉子進行壓力測試）
    const testLeaves = [];
    for (let i = 0; i < 20; i++) {
        // 生成簡單的遞增值，確保都在域內
        const leafValue = (i + 1).toString(16).padStart(64, '0');
        testLeaves.push('0x' + leafValue);
    }
    
    for (let i = 0; i < testLeaves.length; i++) {
        const leaf = testLeaves[i];
        console.log(`\n2.${i+1} 測試葉子: ${leaf.substring(0, 18)}...`);
        
        // 合約插入
        console.log("合約插入...");
        const contractTx = await merkle.insert(leaf);
        await contractTx.wait();
        const contractRoot = await merkle.getLastRoot();
        const contractIndex = await merkle.nextIndex();
        
        // 內存插入
        console.log("\n內存插入...");
        const memoryIndex = await memoryTree.insert(leaf);
        const memoryRoot = memoryTree.getLastRoot();
        
        // 對比結果
        console.log(`\n結果對比:`);
        console.log(`合約根: ${contractRoot}`);
        console.log(`內存根: ${memoryRoot}`);
        console.log(`根匹配: ${contractRoot === memoryRoot ? '✅' : '❌'}`);
        console.log(`合約 nextIndex: ${contractIndex}, 內存 nextIndex: ${memoryTree.nextIndex}`);
        
        // 對比 filledSubtrees
        console.log("\nfilledSubtrees 對比:");
        for (let level = 0; level < Math.min(3, levels); level++) {
            const contractFilled = await merkle.filledSubtrees(level);
            const memoryFilled = memoryTree.filledSubtrees[level];
            const match = contractFilled === memoryFilled;
            console.log(`Level ${level}: ${match ? '✅' : '❌'}`);
            if (!match) {
                console.log(`  合約: ${contractFilled}`);
                console.log(`  內存: ${memoryFilled}`);
            }
        }
        
        if (contractRoot !== memoryRoot) {
            console.log("\n❌ 根不匹配，停止測試");
            break;
        }
    }
}

// 運行測試
if (require.main === module) {
    testMemoryVsContract()
        .then(() => {
            console.log("\n測試完成！");
            process.exit(0);
        })
        .catch((error) => {
            console.error("測試失敗:", error);
            process.exit(1);
        });
}

module.exports = { TornadoTree, testMemoryVsContract };