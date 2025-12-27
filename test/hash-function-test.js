const { ethers } = require("hardhat");
const circomlib = require('circomlibjs');

async function testHashFunctions() {
    console.log("=== 測試哈希函數差異 ===\n");
    
    // 連接合約
    const hasherAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const merkleAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
    const [signer] = await ethers.getSigners();
    
    const hasherABI = ["function MiMCSponge(uint256 in_xL, uint256 in_xR, uint256 k) external pure returns (uint256 xL, uint256 xR)"];
    const merkleABI = [
        "function zeros(uint256 i) external pure returns (bytes32)",
        "function hashLeftRight(address _hasher, bytes32 _left, bytes32 _right) external pure returns (bytes32)"
    ];
    
    const hasher = new ethers.Contract(hasherAddress, hasherABI, signer);
    const merkle = new ethers.Contract(merkleAddress, merkleABI, signer);
    
    // 測試參數
    const left = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const right = await merkle.zeros(0); // Level 0 的零值
    
    console.log("測試參數:");
    console.log(`Left:  ${left}`);
    console.log(`Right: ${right}\n`);
    
    // 1. 直接調用 hasher.MiMCSponge
    console.log("1. 直接調用 hasher.MiMCSponge:");
    try {
        const result1 = await hasher.MiMCSponge(BigInt(left), BigInt(right), 0);
        const hash1 = '0x' + result1[0].toHexString().slice(2).padStart(64, '0');
        console.log(`結果 xL: ${hash1}`);
        console.log(`結果 xR: ${result1[1].toHexString()}`);
    } catch (error) {
        console.log("失敗:", error.message);
    }
    
    // 2. 調用合約的 hashLeftRight
    console.log("\n2. 調用合約的 hashLeftRight:");
    try {
        const hash2 = await merkle.hashLeftRight(hasherAddress, left, right);
        console.log(`結果: ${hash2}`);
    } catch (error) {
        console.log("失敗:", error.message);
    }
    
    // 3. 本地 circomlib 計算
    console.log("\n3. 本地 circomlib 計算:");
    try {
        const mimc = await circomlib.buildMimcSponge();
        const l = BigInt(left);
        const r = BigInt(right);
        let elt = mimc.multiHash([l, r], 0n);
        if (Array.isArray(elt)) elt = elt[0];
        const out = mimc.F.toObject(elt);
        const hash3 = '0x' + out.toString(16).padStart(64, '0');
        console.log(`結果: ${hash3}`);
    } catch (error) {
        console.log("失敗:", error.message);
    }
    
    // 4. 手動實現合約的 hashLeftRight 邏輯
    console.log("\n4. 手動模擬合約 hashLeftRight:");
    try {
        // 根據合約代碼: 
        // uint256 R = uint256(_left);
        // uint256 C = 0;
        // (R, C) = _hasher.MiMCSponge(R, C, 0);
        // R = addmod(R, uint256(_right), FIELD_SIZE);
        // (R, C) = _hasher.MiMCSponge(R, C, 0);
        
        const FIELD_SIZE = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
        
        let R = BigInt(left);
        let C = 0n;
        
        // 第一次 MiMCSponge
        const result1 = await hasher.MiMCSponge(R, C, 0);
        R = result1[0];
        C = result1[1];
        console.log(`第一次 MiMC 後: R=${R.toString(16)}, C=${C.toString(16)}`);
        
        // addmod
        R = (R + BigInt(right)) % FIELD_SIZE;
        console.log(`加法後: R=${R.toString(16)}`);
        
        // 第二次 MiMCSponge
        const result2 = await hasher.MiMCSponge(R, C, 0);
        R = result2[0];
        C = result2[1];
        
        const hash4 = '0x' + R.toHexString().slice(2).padStart(64, '0');
        console.log(`最終結果: ${hash4}`);
        
    } catch (error) {
        console.log("失敗:", error.message);
    }
    
    console.log("\n=== 比較所有結果 ===");
    // 重新運行所有計算並比較
    
}

testHashFunctions().catch(console.error);