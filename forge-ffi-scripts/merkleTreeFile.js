const fs = require('fs');
const path = require('path');
const circomlib = require('circomlibjs');

const BASE_ZERO_VALUE = BigInt('21663839004416932945382355908790599225266501822907911457504978515578255421292');
const FIELD_SIZE = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const DEFAULT_DEPTH = 20;
const DEFAULT_FILE = path.join(process.cwd(), 'merkle-tree-data.json');

const normalizeHex = (str) => {
    const s = str.startsWith('0x') ? str.slice(2) : str;
    return s.toLowerCase().padStart(64, '0');
};

class FileMerkleTreeClient {
    constructor({ depth = DEFAULT_DEPTH, filePath = DEFAULT_FILE } = {}) {
        this.depth = depth;
        this.filePath = filePath;
        this.mimc = null;
        this.zeroCache = {};
        this.state = null;
    }

    async init() {
        this.mimc = await circomlib.buildMimcSponge();
        this.state = this._loadState() || this._createEmptyState();
        if (!this._getNode(this.depth, 0)) {
            this._setNode(this.depth, 0, this.getZeroValue(this.depth));
            this._saveState();
        }
        return this;
    }

    _createEmptyState() {
        const nodes = Array.from({ length: this.depth + 1 }, () => []);
        nodes[this.depth][0] = this.getZeroValue(this.depth);
        return {
            depth: this.depth,
            nextIndex: 0,
            leaves: [],
            nodes
        };
    }

    _loadState() {
        try {
            if (!fs.existsSync(this.filePath)) return null;
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.depth !== this.depth) return null;
            return parsed;
        } catch (err) {
            console.warn('[MerkleTreeFile] Failed to load state, re-initializing:', err.message);
            return null;
        }
    }

    _saveState() {
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    }

    _toField(x) {
        if (typeof x === 'bigint') return ((x % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE;
        if (typeof x === 'number') return ((BigInt(x) % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE;
        if (typeof x === 'string') {
            let s = x.trim();
            if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
            if (!/^[0-9a-fA-F]*$/.test(s)) {
                throw new Error(`Invalid hex string: ${x}`);
            }
            if (s.length === 0) s = '0';
            const v = BigInt('0x' + s);
            return ((v % FIELD_SIZE) + FIELD_SIZE) % FIELD_SIZE;
        }
        if (x && typeof x.toString === 'function') {
            return this._toField(x.toString());
        }
        throw new Error(`Unsupported field element type: ${typeof x}`);
    }

    _mimcHash(left, right) {
        if (!this.mimc) throw new Error('MiMC not initialized. Call init() first.');
        const l = this._toField(left);
        const r = this._toField(right);
        let out = this.mimc.multiHash([l, r], 0n);
        if (Array.isArray(out)) out = out[0];
        return this.mimc.F.toObject(out).toString(16).padStart(64, '0');
    }

    getZeroValue(level) {
        if (this.zeroCache[level] !== undefined) return this.zeroCache[level];
        if (level === 0) {
            this.zeroCache[level] = BASE_ZERO_VALUE.toString(16).padStart(64, '0');
        } else {
            const lower = this.getZeroValue(level - 1);
            this.zeroCache[level] = this._mimcHash(lower, lower);
        }
        return this.zeroCache[level];
    }

    _getNode(level, index) {
        const layer = this.state.nodes[level] || [];
        return layer[index];
    }

    _setNode(level, index, value) {
        if (!this.state.nodes[level]) this.state.nodes[level] = [];
        this.state.nodes[level][index] = value;
    }

    _normalizeLeaf(data) {
        return this._toField(data).toString(16).padStart(64, '0');
    }

    _findLeafIndexByHash(hash) {
        return this.state.leaves.findIndex((leaf) => normalizeHex(leaf.hash) === normalizeHex(hash));
    }

    addLeaf(data) {
        if (!this.mimc) throw new Error('Call init() before addLeaf');

        const leafHash = this._normalizeLeaf(data);
        if (this._findLeafIndexByHash(leafHash) !== -1) {
            throw new Error('Leaf already exists');
        }

        const index = this.state.nextIndex;
        const maxLeaves = Math.pow(2, this.depth);
        if (index >= maxLeaves) {
            throw new Error('Tree is full');
        }

        this._setNode(0, index, leafHash);
        this.state.leaves.push({
            hash: leafHash,
            data,
            index,
            createdAt: new Date().toISOString()
        });

        let currentIndex = index;
        for (let level = 1; level <= this.depth; level++) {
            const parentIndex = Math.floor(currentIndex / 2);
            const left = this._getNode(level - 1, parentIndex * 2) ?? this.getZeroValue(level - 1);
            const right = this._getNode(level - 1, parentIndex * 2 + 1) ?? this.getZeroValue(level - 1);
            const parentHash = this._mimcHash(left, right);
            this._setNode(level, parentIndex, parentHash);
            currentIndex = parentIndex;
        }

        this.state.nextIndex += 1;
        this._saveState();

        return {
            leaf: { hash: leafHash, data, index, createdAt: new Date().toISOString() },
            root: this.getRoot(),
            treeStats: this.getTreeStats()
        };
    }

    getProof(leafHash) {
        const idx = this._findLeafIndexByHash(leafHash);
        if (idx === -1) throw new Error('Leaf not found');

        let currentIndex = idx;
        const pathElements = [];
        const pathIndices = [];

        for (let level = 0; level < this.depth; level++) {
            const isLeft = currentIndex % 2 === 0;
            const siblingIdx = isLeft ? currentIndex + 1 : currentIndex - 1;
            const sibling = this._getNode(level, siblingIdx) ?? this.getZeroValue(level);
            pathElements.push('0x' + sibling);
            pathIndices.push(isLeft ? 0 : 1);
            currentIndex = Math.floor(currentIndex / 2);
        }

        return {
            leaf: this.state.leaves[idx],
            pathElements,
            pathIndices,
            root: this.getRoot(),
            depth: this.depth
        };
    }

    verifyProof(leafHash, pathElements, pathIndices, expectedRoot) {
        let currentHash = normalizeHex(leafHash);

        for (let i = 0; i < pathElements.length; i++) {
            const sibling = normalizeHex(pathElements[i]);
            if (pathIndices[i] === 0) {
                currentHash = this._mimcHash(currentHash, sibling);
            } else {
                currentHash = this._mimcHash(sibling, currentHash);
            }
        }

        const computed = '0x' + currentHash;
        const normalizedExpected = expectedRoot.startsWith('0x') ? expectedRoot : '0x' + expectedRoot;
        return computed.toLowerCase() === normalizedExpected.toLowerCase();
    }

    getRoot() {
        const root = this._getNode(this.depth, 0) ?? this.getZeroValue(this.depth);
        return '0x' + root;
    }

    getLeaves() {
        return [...this.state.leaves];
    }

    getTreeStats() {
        const leafCount = this.state.nextIndex;
        const capacity = Math.pow(2, this.depth);
        return {
            leafCount,
            capacity,
            depth: this.depth,
            rootHash: this.getRoot(),
            utilizationRate: (leafCount / capacity * 100).toFixed(2) + '%'
        };
    }

    reset() {
        this.state = this._createEmptyState();
        this._saveState();
        return this.getTreeStats();
    }
}

async function createFileMerkleTreeClient(options = {}) {
    const client = new FileMerkleTreeClient(options);
    await client.init();
    return client;
}

module.exports = {
    createFileMerkleTreeClient,
    FileMerkleTreeClient
};
