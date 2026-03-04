import { createContext, useContext, useState, useEffect, useCallback } from 'react'

// ── Wallet helpers ──────────────────────────────────────────────
const WALLET_KEY = 'nara_wallet_v1'
const MODEL_KEY  = 'nara_model_v1'

export const DEFAULT_RPC = 'https://mainnet-api.nara.build/'

// ── Agent ID generator ──────────────────────────────────────────
const _ADJ  = ['CYBER','QUANTUM','NEURAL','GHOST','PHANTOM','IRON','NEON','DELTA','SWIFT','VOID','SIGMA','ALPHA','NOVA','PRIME','PULSE']
const _NOUN = ['WOLF','EAGLE','CIPHER','NODE','BYTE','FLUX','GRID','APEX','NEXUS','HAWK','RAVEN','FORGE','ECHO','SPARK','CORE']
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
    const data  = { baseUrl: '', model: '', apiKey: '', rpcUrl: DEFAULT_RPC, agentId: genAgentId(), ...saved }
    if (!saved.agentId) localStorage.setItem(MODEL_KEY, JSON.stringify(data)) // persist generated ID
    return data
  } catch { return { baseUrl: '', model: '', apiKey: '', rpcUrl: DEFAULT_RPC, agentId: genAgentId() } }
}

export function saveModel(data) {
  localStorage.setItem(MODEL_KEY, JSON.stringify(data))
}

// ── Context ──────────────────────────────────────────────────────
const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [wallet, setWallet] = useState(() => loadWallet())
  const [model, setModel]   = useState(() => loadModel())
  const [modelOk, setModelOk] = useState(false)

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

  return (
    <AppContext.Provider value={{
      wallet, setWallet, clearWallet,
      model, updateModel,
      modelOk, setModelOk,
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
