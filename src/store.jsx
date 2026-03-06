import { createContext, useContext, useState, useEffect, useCallback } from 'react'

// ── Wallet helpers ──────────────────────────────────────────────
const WALLET_KEY    = 'nara_wallet_v1'
const MODEL_KEY     = 'nara_model_v1'
const MODEL_OK_KEY  = 'nara_model_ok_v1'
const REFERRAL_KEY  = 'nara_referral_v1'

export { IS_TESTNET, DEFAULT_RPC, DEFAULT_RELAY, DEFAULT_TESTNET_RPC, DEFAULT_TESTNET_RELAY } from './constants.js'
import { IS_TESTNET, DEFAULT_RPC, DEFAULT_RELAY, DEFAULT_TESTNET_RPC, DEFAULT_TESTNET_RELAY } from './constants.js'

const RPC_URL   = IS_TESTNET ? DEFAULT_TESTNET_RPC   : DEFAULT_RPC
const RELAY_URL = IS_TESTNET ? DEFAULT_TESTNET_RELAY  : DEFAULT_RELAY

// ── Agent ID generator ──────────────────────────────────────────
const _ADJ  = ['cyber','quantum','neural','ghost','phantom','iron','neon','delta','swift','void','sigma','alpha','nova','prime','pulse']
const _NOUN = ['wolf','eagle','cipher','node','byte','flux','grid','apex','nexus','hawk','raven','forge','echo','spark','core']
export function genAgentId() {
  const a = _ADJ[Math.floor(Math.random() * _ADJ.length)]
  const n = _NOUN[Math.floor(Math.random() * _NOUN.length)]
  const d = String(Math.floor(Math.random() * 9000) + 1000)
  return `${a}-${n}-${d}`
}

export function loadWallet() {
  try {
    const raw = localStorage.getItem(WALLET_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveWallet(data) {
  localStorage.setItem(WALLET_KEY, JSON.stringify(data))
}

export function loadModel() {
  try {
    const raw  = localStorage.getItem(MODEL_KEY)
    const saved = raw ? JSON.parse(raw) : {}
    const data  = { baseUrl: '', model: '', apiKey: '', agentId: genAgentId(), ...saved }
    if (!saved.agentId) localStorage.setItem(MODEL_KEY, JSON.stringify(data)) // persist generated ID
    return data
  } catch { return { baseUrl: '', model: '', apiKey: '', agentId: genAgentId() } }
}

export function saveModel(data) {
  localStorage.setItem(MODEL_KEY, JSON.stringify(data))
}

// ── Context ──────────────────────────────────────────────────────
const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [wallet, setWallet] = useState(() => loadWallet())
  const [model, setModel]   = useState(() => loadModel())
  const [modelOk, setModelOkState] = useState(() => localStorage.getItem(MODEL_OK_KEY) === '1')
  const [referral, setReferralState] = useState(() => {
    try { return localStorage.getItem(REFERRAL_KEY) || '' } catch { return '' }
  })

  const setReferral = useCallback((id) => {
    setReferralState(id)
    if (id) localStorage.setItem(REFERRAL_KEY, id)
    else localStorage.removeItem(REFERRAL_KEY)
  }, [])

  const setModelOk = useCallback((v) => {
    setModelOkState(v)
    localStorage.setItem(MODEL_OK_KEY, v ? '1' : '0')
  }, [])

  // Persist wallet whenever it changes
  useEffect(() => {
    if (wallet) saveWallet(wallet)
    else localStorage.removeItem(WALLET_KEY)
  }, [wallet])

  const updateModel = useCallback((data) => {
    setModel(data)
    saveModel(data)
  }, [])

  const clearWallet = useCallback(() => {
    localStorage.removeItem(WALLET_KEY)
    setWallet(null)
  }, [])

  const rpcUrl   = RPC_URL
  const relayUrl = RELAY_URL

  return (
    <AppContext.Provider value={{
      wallet, setWallet, clearWallet,
      model, updateModel,
      modelOk, setModelOk,
      rpcUrl, relayUrl,
      referral, setReferral,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
