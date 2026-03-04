# NARA Agent Web

Browser-based agent for **Proof of Machine Intelligence (PoMI)** mining on the [Nara](https://nara.build) blockchain. Answer on-chain quests using AI, generate ZK proofs, and earn NARA rewards — all from your browser.

## Features

- **PoMI Mining** — Fetch quests, answer via AI (OpenAI-compatible endpoint), generate Groth16 ZK proofs, and submit answers on-chain. Supports auto-mining loop with configurable start/stop.
- **Solana Wallet** — Create or import a Solana wallet (mnemonic or private key). View balance, copy address, and transfer SOL.
- **Settings** — Configure AI model endpoint (base URL, model ID, API key), Solana RPC URL, agent ID, language, and manage private key export / data clearing.
- **Multi-language** — English, 中文, 日本語, 한국어.

## Tech Stack

- [Vite](https://vitejs.dev) 5 + [React](https://react.dev) 18
- [react-router-dom](https://reactrouter.com) 6
- [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/) for blockchain interaction
- [nara-sdk](https://www.npmjs.com/package/nara-sdk) for quest fetching, proof generation, and submission
- [bip39](https://github.com/bitcoinjs/bip39) + [ed25519-hd-key](https://github.com/nicola/ed25519-hd-key) for HD key derivation
- [snarkjs](https://github.com/iden3/snarkjs) (via nara-sdk) for Groth16 ZK proofs
- Pure CSS — no utility frameworks

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Production build
npm run build
```

## Project Structure

```
src/
├── App.jsx              # Router setup, providers
├── store.jsx            # Global state (wallet, model config) via React Context
├── i18n.jsx             # I18n provider + translations (en/zh/ja/ko)
├── quest.js             # Quest fetch, ZK proof, on-chain submission helpers
├── index.css            # Design system (CSS variables, shared components)
├── components/
│   ├── Nav.jsx          # Bottom navigation bar
│   └── Nav.css
└── pages/
    ├── PoMI.jsx         # Mining page — quest display, auto-mining loop
    ├── PoMI.css
    ├── Wallet.jsx       # Wallet create/import/transfer
    ├── Wallet.css
    ├── Settings.jsx     # AI endpoint, RPC, language, clear data
    └── Settings.css
```

## How It Works

1. **Connect AI** — In Settings, configure an OpenAI-compatible chat completions endpoint.
2. **Create Wallet** — Generate a new Solana keypair or import an existing one.
3. **Start Mining** — The agent fetches on-chain quests, sends the question to your AI endpoint, generates a ZK proof of the answer, and submits it on-chain (via gasless relay or direct transaction).
4. **Auto-loop** — When auto-mining is active, the agent waits for the next round after each submission and continues automatically.

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| AI Base URL | OpenAI-compatible `/v1` endpoint | — |
| Model ID | Model name (e.g. `gpt-5.2`) | — |
| API Key | Bearer token for the AI endpoint | — |
| RPC URL | Solana RPC endpoint | `https://mainnet-api.nara.build/` |
| Language | UI language | `en` |

All settings are stored in `localStorage`.

## License

MIT
