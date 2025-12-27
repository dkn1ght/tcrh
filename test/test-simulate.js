const { ethers } = require("hardhat");
const axios = require('axios');

// 手動模擬 Tornado 的 _insert 邏輯
async function simulateContractInsert(leafHash, hasherContract) {
    console.log(`模擬合約插入邏輯: ${leafHash}`);
    
    const levels = 17; // 你的樹層數
    let currentIndex = 0; // 第一個葉子的索引
    let currentLevelHash = leafHash;
    
    // 預先計算的零值（從你的服務器 API 獲取）
    const zeroResp = await axios.get('http://localhost:3000/api/zero-values');
    const zeros = zeroResp.data.myCalculated;
    
    console.log("模擬 Tornado 插入過程:");
    
    for (let i = 0; i < levels; i++) {
        let left, right;
        
        if (currentIndex % 2 === 0) {
            // 左子節點
            left = currentLevelHash;
            right = zeros[i];
            console.log(`Level ${i}: 左=${left.substring(0, 16)}..., 右=${zeros[i].substring(2, 18)}... (零值)`);
        } else {
            // 右子節點（這裡會用到 filledSubtrees）
            left = "填充的子樹值"; // 這個需要從合約狀態獲取
            right = currentLevelHash;
            console.log(`Level ${i}: 左=填充值, 右=${currentLevelHash.substring(0, 16)}...`);
        }
        
        // 使用合約的哈希方法計算
        const leftBigInt = BigInt(left);
        const rightBigInt = BigInt(right);
        
        // 調用 hasher 合約計算哈希
        let result = await hasherContract.MiMCSponge(leftBigInt, rightBigInt, 0);
        let R = result[0]; // xL
        currentLevelHash = '0x' + R.toHexString().slice(2).padStart(64, '0');
        
        console.log(`  → 新哈希: ${currentLevelHash.substring(0, 16)}...`);
        
        currentIndex = Math.floor(currentIndex / 2);
    }
    
    console.log(`最終根: ${currentLevelHash}`);
    return currentLevelHash;
}

async function debugTreeLogic() {
    console.log("=== 調試樹構建邏輯差異 ===\n");
    
    // 連接合約
    const hasherAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const [signer] = await ethers.getSigners();
    const hasherABI = ["function MiMCSponge(uint256 in_xL, uint256 in_xR, uint256 k) external pure returns (uint256 xL, uint256 xR)"];
    const hasher = new ethers.Contract(hasherAddress, hasherABI, signer);
    
    const testLeaf = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    
    // 1. 服務器的方式
    console.log("1. 服務器插入方式:");
    try {
        const serverResp = await axios.post('http://localhost:3000/api/leaves', { data: testLeaf });
        console.log(`服務器根: ${serverResp.data.rootHash}`);
    } catch (error) {
        console.log("服務器插入失敗:", error.message);
    }
    
    // 2. 手動模擬合約方式
    console.log("\n2. 手動模擬合約插入:");
    try {
        const simulatedRoot = await simulateContractInsert(testLeaf, hasher);
        console.log(`模擬根: ${simulatedRoot}`);
    } catch (error) {
        console.log("模擬失敗:", error.message);
    }
    
    // 3. 檢查合約的 filledSubtrees
    console.log("\n3. 檢查合約狀態:");
    const merkleAddress = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
    const merkleABI = [
        "function filledSubtrees(uint256) external view returns (bytes32)",
        "function nextIndex() external view returns (uint32)",
        "function levels() external view returns (uint32)"
    ];
    const merkle = new ethers.Contract(merkleAddress, merkleABI, signer);
    
    try {
        const levels = await merkle.levels();
        const nextIndex = await merkle.nextIndex();
        console.log(`合約層數: ${levels}, 下一個索引: ${nextIndex}`);
        
        console.log("filledSubtrees 狀態:");
        for (let i = 0; i < Math.min(5, levels); i++) {
            const filled = await merkle.filledSubtrees(i);
            console.log(`Level ${i}: ${filled}`);
        }
    } catch (error) {
        console.log("檢查合約狀態失敗:", error.message);
    }
}

debugTreeLogic().catch(console.error);