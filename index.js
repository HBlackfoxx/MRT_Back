// backend/index.js
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store used nonces to prevent replay attacks
const usedNonces = new Set();

// Rate limiting
const requestCounts = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

// Rate limiting middleware
function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  
  if (!requestCounts[ip]) {
    requestCounts[ip] = { count: 0, timestamp: now };
  }
  
  // Reset count if window has passed
  if (now - requestCounts[ip].timestamp > RATE_LIMIT_WINDOW) {
    requestCounts[ip] = { count: 0, timestamp: now };
  }
  
  // Increment count
  requestCounts[ip].count++;
  
  // Check if over limit
  if (requestCounts[ip].count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }
  
  next();
}

// Generate a signature for NFT minting
app.post('/api/sign', rateLimiter, async (req, res) => {
  try {
    const { address, quantity, nonce } = req.body;
    
    // Validation
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    
    if (!quantity || quantity <= 0 || quantity > 10) {
      return res.status(400).json({ error: 'Invalid quantity. Must be between 1 and 10.' });
    }
    
    if (!nonce) {
      return res.status(400).json({ error: 'Nonce is required' });
    }
    
    // Check if nonce was used before
    const nonceHash = crypto.createHash('sha256').update(nonce.toString()).digest('hex');
    if (usedNonces.has(nonceHash)) {
      return res.status(400).json({ error: 'Nonce already used' });
    }
    
    // Get signer wallet from environment variable
    const signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
    if (!signerPrivateKey) {
      console.error('SIGNER_PRIVATE_KEY not set in environment');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const wallet = new ethers.Wallet(signerPrivateKey);

    // Define rarity probabilities (sum should equal 1.0)
    const rarityProbabilities = {
      0: 0.50, // COMMON: 50%
      1: 0.25, // UNCOMMON: 25%
      2: 0.15, // RARE: 15%
      3: 0.07, // EPIC: 7%
      4: 0.03  // LEGENDARY: 3%
    };

    // Function to generate a random rarity based on probabilities
    function getRandomRarity() {
      const random = Math.random();
      let cumulativeProbability = 0;

      for (const [rarity, probability] of Object.entries(rarityProbabilities)) {
        cumulativeProbability += probability;
        if (random <= cumulativeProbability) {
          return parseInt(rarity);
        }
      }
      return 0; // Fallback to COMMON if something goes wrong
    }

    // Generate rarities for NFTs
    const rarities = [];
    for (let i = 0; i < quantity; i++) {
      const rarity = getRandomRarity();
      rarities.push(rarity);
    }

    // Convert rarities to bytes
    const encodedRarities = ethers.concat(
      rarities.map(r => new Uint8Array([r]))
    );
    
    // Create message to sign as expected by the smart contract
    // message = keccak256(abi.encodePacked(recipient, nonce, quantity, encodedRarities))
    const messageHash = ethers.keccak256(
      ethers.solidityPacked(
        ['address', 'bytes32', 'uint256', 'bytes'],
        [address, nonce, quantity, encodedRarities]
      )
    );
    
    // Sign the hash using EIP-191 format
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));
    
    // Combine rarities with signature
    // First byte(s) are the rarities, followed by the signature
    const fullSignature = ethers.concat([encodedRarities, ethers.getBytes(signature)]);
    
    // Mark nonce as used
    usedNonces.add(nonceHash);
    
    // Clean up old nonces (optional - for a production system you might use Redis with TTL)
    if (usedNonces.size > 1000) {
      const oldestNonces = Array.from(usedNonces).slice(0, 100);
      oldestNonces.forEach(n => usedNonces.delete(n));
    }
    
    // Return the signature
    return res.json({
      signature: ethers.hexlify(fullSignature),
      nonce
    });
    
  } catch (error) {
    console.error('Error generating signature:', error);
    return res.status(500).json({ error: 'Failed to generate signature' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Signature server running on port ${PORT}`);
});