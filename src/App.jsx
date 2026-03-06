import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Connection } from '@solana/web3.js'
import bs58 from 'bs58'
import { AppProvider, useApp } from './store.jsx'
import { IS_TESTNET } from './constants.js'
import { I18nProvider, useI18n } from './i18n.jsx'
import { checkAgentRegistered } from './quest.js'
import Nav from './components/Nav.jsx'
import PoMI from './pages/PoMI.jsx'
import Wallet from './pages/Wallet.jsx'
import Settings from './pages/Settings.jsx'

function AppShell() {
  const { t } = useI18n()
  const { rpcUrl, referral, setReferral } = useApp()

  // Parse ?referral=xxxx from URL, bs58 decode to agent ID, validate and save
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('referral')
    if (!ref) return

    let agentId
    try {
      const decoded = bs58.decode(ref)
      agentId = new TextDecoder().decode(decoded)
    } catch {
      return // invalid bs58
    }
    if (!agentId || agentId === referral) return

    // Validate on-chain
    const conn = new Connection(rpcUrl, 'confirmed')
    checkAgentRegistered(conn, agentId).then(registered => {
      if (registered) setReferral(agentId)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BrowserRouter>
      <div className={IS_TESTNET ? 'testnet-active' : ''}>
        {IS_TESTNET && (
          <div className="testnet-banner">{t('testnet.banner')}</div>
        )}
        <Nav />
        <Routes>
          <Route path="/"        element={<PoMI />} />
          <Route path="/wallet"  element={<Wallet />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <I18nProvider>
    <AppProvider>
      <AppShell />
    </AppProvider>
    </I18nProvider>
  )
}
