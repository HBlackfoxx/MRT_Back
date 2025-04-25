# Signature Backend Setup

## Prerequisites
- Node.js 16+ installed
- npm or yarn

## Installation

1. Create a new directory for the backend:
```bash
mkdir mrt-signature-backend
cd mrt-signature-backend
```

2. Initialize a new Node.js project:
```bash
npm init -y
```

3. Install the required dependencies:
```bash
npm install express cors dotenv ethers@6 crypto
```

4. Create a `.env` file with your configuration:
```
PORT=3001
SIGNER_PRIVATE_KEY=0x123456789abcdef123456789abcdef123456789abcdef123456789abcdef1234
# Replace with your actual private key for the trusted oracle account
```

5. Create an `index.js` file with the provided code.

## Important Security Notes

1. Make sure to replace the placeholder private key with the actual private key corresponding to the trusted oracle address in your smart contract.

2. NEVER share your private key or commit it to version control. The `.env` file should be added to your `.gitignore`.

3. In production, use environment variables securely stored in your deployment environment.

4. Consider adding HTTPS in production for secure communication.

## Running the Server

1. Start the server:
```bash
node index.js
```

2. The server will start on port 3001 (or the port specified in your .env file).

3. Verify it's working with a curl request:
```bash
curl http://localhost:3001/health
```

## Testing the Signature Endpoint

You can test the signature endpoint with:

```bash
curl -X POST http://localhost:3001/api/sign \
  -H "Content-Type: application/json" \
  -d '{"address":"0xYourWalletAddress", "quantity":1, "nonce":"0x12345"}'
```

## Deploying to Production

For production deployment, consider:

1. Using a process manager like PM2:
```bash
npm install -g pm2
pm2 start index.js --name mrt-signature-service
```

2. Setting up a reverse proxy with Nginx or similar.

3. Adding proper logging for production monitoring.