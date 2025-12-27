const axios = require('axios');

async function testServerTornado() {
    console.log('=== 測試服務器 Tornado 實現 ===\n');
    
    try {
        // 1. 檢查初始狀態
        console.log('1. 檢查初始狀態');
        const initialRoot = await axios.get('http://localhost:3000/api/root');
        console.log(`初始根: ${initialRoot.data.rootHash}`);
        console.log(`葉子數: ${initialRoot.data.leafCount}\n`);
        
        // 2. 插入測試葉子
        const testLeaves = [
            '0x0000000000000000000000000000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000000000000000000000000000002',
            '0x0000000000000000000000000000000000000000000000000000000000000003'
        ];
        
        for (let i = 0; i < testLeaves.length; i++) {
            const leaf = testLeaves[i];
            console.log(`2.${i+1} 插入葉子: ${leaf}`);
            
            const response = await axios.post('http://localhost:3000/api/leaves', { data: leaf });
            
            console.log(`  索引: ${response.data.leaf.index}`);
            console.log(`  根哈希: ${response.data.rootHash}`);
            console.log('  ✅ 插入成功\n');
        }
        
        // 3. 檢查最終狀態
        console.log('3. 檢查最終狀態');
        const finalRoot = await axios.get('http://localhost:3000/api/root');
        console.log(`最終根: ${finalRoot.data.rootHash}`);
        console.log(`最終葉子數: ${finalRoot.data.leafCount}`);
        
        console.log('\n🎉 服務器 Tornado 實現測試完成！');
        
    } catch (error) {
        console.error('❌ 測試失敗:', error.response?.data || error.message);
    }
}
testServerTornado();