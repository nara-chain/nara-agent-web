// ── Network configuration ────────────────────────────────────
export const IS_TESTNET = true

// Mainnet
export const DEFAULT_RPC   = 'https://mainnet-api.nara.build/'
export const DEFAULT_RELAY = 'https://quest-api.nara.build'

// Testnet (devnet)
export const DEFAULT_TESTNET_RPC   = 'https://devnet-api.nara.build/'
export const DEFAULT_TESTNET_RELAY = 'https://devnet-quest-api.nara.build'

// Address Lookup Table (ALT) — reduces tx size for multi-instruction transactions
export const DEFAULT_ALT_ADDRESS         = ''  // TODO: set mainnet ALT address
export const DEFAULT_TESTNET_ALT_ADDRESS = 'GP5Uq8q6fRyE2oAGG4VVqrEgReL8kk3vAgsnjrhXefab'
