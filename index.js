// backend/index.js
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const crypto = require('crypto');
require('dotenv').config();

console.log('Starting server...');
console.log('Environment variables:', {
  PORT: process.env.PORT,
  FRONTEND_URL: process.env.FRONTEND_URL,
  NODE_ENV: process.env.NODE_ENV,
  SIGNER_PRIVATE_KEY: process.env.SIGNER_PRIVATE_KEY ? 'Set' : 'Not set'
});

const app = express();
const PORT = process.env.PORT || 3001;

// Enhanced CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Add this if you're using cookies or authentication
}));

// Limit payload size
app.use(express.json({ limit: '10kb' }));

// Store used nonces
const usedNonces = new Set();

// Rate limiting
const requestCounts = {};
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;

setInterval(() => {
  const now = Date.now();
  for (const ip in requestCounts) {
    if (now - requestCounts[ip].timestamp > RATE_LIMIT_WINDOW) {
      delete requestCounts[ip];
    }
  }
}, 5 * 60 * 1000);

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  if (!requestCounts[ip]) {
    requestCounts[ip] = { count: 0, timestamp: now };
  }
  if (now - requestCounts[ip].timestamp > RATE_LIMIT_WINDOW) {
    requestCounts[ip] = { count: 0, timestamp: now };
  }
  requestCounts[ip].count++;
  if (requestCounts[ip].count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }
  next();
}

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Signature endpoint
app.post('/api/sign', rateLimiter, async (req, res) => {
  try {
    console.log('Received /api/sign request:', {
      body: req.body,
      ip: req.ip,
      headers: req.headers
    });

    const { address, quantity, nonce } = req.body;

    if (!address || !ethers.isAddress(address)) {
      console.log('Validation failed: Invalid address', { address });
      return res.status(400).json({ error: 'Invalid address' });
    }

    if (!quantity || isNaN(quantity) || quantity <= 0 || quantity > 10) {
      console.log('Validation failed: Invalid quantity', { quantity });
      return res.status(400).json({ error: 'Invalid quantity. Must be between 1 and 10.' });
    }

    if (!nonce || typeof nonce !== 'string' || !nonce.startsWith('0x')) {
      console.log('Validation failed: Invalid nonce', { nonce });
      return res.status(400).json({ error: 'Invalid nonce format' });
    }

    const nonceHash = crypto.createHash('sha256').update(nonce.toString()).digest('hex');
    if (usedNonces.has(nonceHash)) {
      console.log('Validation failed: Nonce already used', { nonce });
      return res.status(400).json({ error: 'Nonce already used' });
    }

    const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
    if (!signerPrivateKey) {
      console.error('SIGNER_PRIVATE_KEY not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    console.log('Creating wallet');
    const wallet = new ethers.Wallet(signerPrivateKey);

    const rarityProbabilities = {
      0: 0.50,
      1: 0.25,
      2: 0.15,
      3: 0.07,
      4: 0.03
    };

    function getRandomRarity() {
      const randomBytes = crypto.randomBytes(4);
      const random = randomBytes.readUInt32LE() / 0xFFFFFFFF;
      let cumulativeProbability = 0;
      for (const [rarity, probability] of Object.entries(rarityProbabilities)) {
        cumulativeProbability += probability;
        if (random <= cumulativeProbability) {
          return parseInt(rarity);
        }
      }
      return 0;
    }

    const rarities = [];
    for (let i = 0; i < quantity; i++) {
      const rarity = getRandomRarity();
      rarities.push(rarity);
    }

    console.log('Generated rarities:', rarities);

    const encodedRarities = ethers.concat(
      rarities.map(r => new Uint8Array([r]))
    );

    console.log('Creating message hash');
    const messageHash = ethers.keccak256(
      ethers.solidityPacked(
        ['address', 'bytes32', 'uint256', 'bytes'],
        [address, nonce, quantity, encodedRarities]
      )
    );

    console.log('Signing message');
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    const fullSignature = ethers.concat([encodedRarities, ethers.getBytes(signature)]);

    usedNonces.add(nonceHash);
    console.log('Nonce stored:', nonceHash);

    if (usedNonces.size > 1000) {
      const oldestNonces = Array.from(usedNonces).slice(0, 100);
      oldestNonces.forEach(n => usedNonces.delete(n));
    }

    console.log('Sending signature response');
    return res.json({
      signature: ethers.hexlify(fullSignature),
      nonce
    });

  } catch (error) {
    console.error('Error in /api/sign:', error.stack);
    return res.status(500).json({ error: `Failed to generate signature: ${error.message}` });
  }
});

// Health check
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Catch-all
app.use((req, res) => {
  console.log('Unhandled route:', req.originalUrl);
  res.status(404).json({ error: 'Not found' });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Signature server running on port ${PORT}`);
  console.log(`CORS origin: ${process.env.FRONTEND_URL || '*'}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});