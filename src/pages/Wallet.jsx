import { useState, useEffect, useCallback } from 'react'
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { useApp } from '../store.jsx'
import { MODEL_HUB_BASE } from '../constants.js'
import { useI18n } from '../i18n.jsx'
import {
  ZKID_DENOMINATIONS, getZkIdInfo, getZkIdConfig, createZkId,
  deposit as zkDeposit, scanClaimableDeposits, withdraw as zkWithdraw,
  deriveIdSecret, generateValidRecipient,
} from '../zkid.js'
import './Wallet.css'

function keypairToStore(kp) {
  return { publicKey: kp.publicKey.toBase58(), secretKey: bs58.encode(kp.secretKey) }
}
function storeToKeypair(stored) {
  return Keypair.fromSecretKey(bs58.decode(stored.secretKey))
}
function truncate(addr, start = 6, end = 4) {
  if (!addr) return ''
  return `${addr.slice(0, start)}…${addr.slice(-end)}`
}

function Toast({ msg, type, onClose }) {
  useEffect(() => { const id = setTimeout(onClose, 3000); return () => clearTimeout(id) }, [onClose])
  return <div className={`toast toast-${type}`}>{msg}</div>
}

export default function Wallet() {
  const { wallet, setWallet, rpcUrl, model, updateModel, setModelOk } = useApp()
  const { t } = useI18n()

  const [tab, setTab]               = useState('main')
  const [importMode, setImportMode] = useState('mnemonic')
  const [inputVal, setInputVal]     = useState('')
  const [balance, setBalance]       = useState(null)
  const [loadingBal, setLoadingBal] = useState(false)
  const [toast, setToast]           = useState(null)
  const [toAddr, setToAddr]         = useState('')
  const [amount, setAmount]         = useState('')
  const [sending, setSending]       = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferTab, setTransferTab] = useState('normal') // 'normal' | 'private' | 'compute'
  const [txResult, setTxResult]     = useState(null) // { ok, sig, error }
  const [confirmSend, setConfirmSend] = useState(false)
  const [confirmZkSend, setConfirmZkSend] = useState(false)
  const [newMnemonic, setNewMnemonic]   = useState('')

  // ZK ID (private transfer) state
  const [zkName, setZkName]             = useState('')
  const [zkDenom, setZkDenom]           = useState(ZKID_DENOMINATIONS[0].value)
  const [zkDepositing, setZkDepositing] = useState(false)
  const [zkResult, setZkResult]         = useState(null) // { ok, sig, error }
  // My ZK ID
  const [myZkName, setMyZkName]           = useState(() => localStorage.getItem('nara_zkid_name') || '')
  const [myZkInfo, setMyZkInfo]           = useState(null) // null = unchecked
  const [zkRegistering, setZkRegistering] = useState(false)
  const [zkDeposits, setZkDeposits]       = useState(null) // null | array
  const [zkScanning, setZkScanning]       = useState(false)
  const [zkWithdrawing, setZkWithdrawing] = useState(null) // index being withdrawn

  // Buy Compute (x402) state
  const [buyAmount, setBuyAmount]       = useState('')
  const [buying, setBuying]             = useState(false)
  const [buyResult, setBuyResult]       = useState(null) // { ok, data, error }
  const [confirmBuy, setConfirmBuy]     = useState(false)
  const [hubConfig, setHubConfig]       = useState(null)  // { address, rate, endpoints }
  const [hubInfo, setHubInfo]           = useState(null)   // { api_key, balance } or 'loading' or 'none'

  const notify = useCallback((msg, type = 'ok') => setToast({ msg, type }), [])

  const clearTransferInputs = useCallback(() => {
    setToAddr(''); setAmount(''); setTxResult(null); setConfirmSend(false)
    setZkName(''); setZkDenom(ZKID_DENOMINATIONS[0].value); setZkResult(null); setConfirmZkSend(false)
    setBuyAmount(''); setBuyResult(null); setConfirmBuy(false)
  }, [])

  const fetchBalance = useCallback(async () => {
    if (!wallet) return
    setLoadingBal(true)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const lamports = await conn.getBalance(new PublicKey(wallet.publicKey))
      setBalance(lamports / LAMPORTS_PER_SOL)
    } catch { setBalance(null) }
    finally { setLoadingBal(false) }
  }, [wallet, rpcUrl])

  useEffect(() => { fetchBalance() }, [fetchBalance])

  const handleCreate = useCallback(() => {
    setNewMnemonic(bip39.generateMnemonic())
    setTab('create')
  }, [])

  const handleConfirmCreate = useCallback(async () => {
    const seed = await bip39.mnemonicToSeed(newMnemonic)
    const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
    const kp = Keypair.fromSeed(derived.key)
    setWallet(keypairToStore(kp))
    setTab('main'); setNewMnemonic('')
    notify(t('wallet.created'))
  }, [newMnemonic, setWallet, notify, t])

  const handleImport = useCallback(async () => {
    if (!inputVal.trim()) { notify(t('wallet.enterKey'), 'err'); return }
    try {
      let kp
      if (importMode === 'mnemonic') {
        if (!bip39.validateMnemonic(inputVal.trim())) { notify(t('wallet.invalidMnemonic'), 'err'); return }
        const seed = await bip39.mnemonicToSeed(inputVal.trim())
        const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
        kp = Keypair.fromSeed(derived.key)
      } else {
        kp = Keypair.fromSecretKey(bs58.decode(inputVal.trim()))
      }
      setWallet(keypairToStore(kp)); setInputVal(''); setTab('main')
      notify(t('wallet.imported'))
    } catch { notify(t('wallet.invalidKey'), 'err') }
  }, [inputVal, importMode, setWallet, notify, t])

  // ── ZK ID handlers ──────────────────────────────────────────
  const handleZkDeposit = useCallback(async () => {
    setConfirmZkSend(false)
    if (!zkName.trim()) return
    setZkDepositing(true); setZkResult(null)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const kp = storeToKeypair(wallet)
      // Verify recipient ZK ID exists
      const info = await getZkIdInfo(conn, zkName.trim())
      if (!info) { notify('ZK ID not found', 'err'); setZkDepositing(false); return }
      const sig = await zkDeposit(conn, kp, zkName.trim(), zkDenom)
      setZkResult({ ok: true, sig })
      fetchBalance()
    } catch (e) {
      setZkResult({ ok: false, error: e.message || t('wallet.depositFailed') })
    } finally { setZkDepositing(false) }
  }, [zkName, zkDenom, wallet, rpcUrl, fetchBalance, notify, t])

  const handleCheckMyZkId = useCallback(async () => {
    if (!myZkName.trim()) return
    localStorage.setItem('nara_zkid_name', myZkName.trim())
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const info = await getZkIdInfo(conn, myZkName.trim())
      setMyZkInfo(info)
    } catch { setMyZkInfo(null) }
  }, [myZkName, rpcUrl])

  useEffect(() => { if (myZkName && showTransfer && transferTab === 'private') handleCheckMyZkId() }, [showTransfer, transferTab])

  const handleZkRegister = useCallback(async () => {
    if (!myZkName.trim()) return
    setZkRegistering(true)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const kp = storeToKeypair(wallet)
      const secret = await deriveIdSecret(kp, myZkName.trim())
      await createZkId(conn, kp, myZkName.trim(), secret)
      notify(t('wallet.zkidRegisterOk'))
      localStorage.setItem('nara_zkid_name', myZkName.trim())
      handleCheckMyZkId()
    } catch (e) { notify(e.message || 'Registration failed', 'err') }
    finally { setZkRegistering(false) }
  }, [myZkName, wallet, rpcUrl, notify, t, handleCheckMyZkId])

  const handleScanDeposits = useCallback(async () => {
    if (!myZkName.trim() || !myZkInfo) return
    setZkScanning(true); setZkDeposits(null)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const kp = storeToKeypair(wallet)
      const secret = await deriveIdSecret(kp, myZkName.trim())
      const deposits = await scanClaimableDeposits(conn, myZkName.trim(), secret)
      setZkDeposits(deposits)
    } catch (e) { notify(e.message, 'err') }
    finally { setZkScanning(false) }
  }, [myZkName, myZkInfo, wallet, rpcUrl, notify])

  const handleWithdraw = useCallback(async (idx) => {
    const dep = zkDeposits[idx]
    setZkWithdrawing(idx)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const kp = storeToKeypair(wallet)
      const secret = await deriveIdSecret(kp, myZkName.trim())

      // Withdraw to a temporary BN254-compatible address, then sweep back — all in one TX
      const tempKp = generateValidRecipient()
      const withdrawIx = await zkWithdraw(conn, kp, myZkName.trim(), secret, dep, tempKp.publicKey)

      const denomLamports = Number(dep.denomination)
      const sweepIx = SystemProgram.transfer({
        fromPubkey: tempKp.publicKey, toPubkey: kp.publicKey, lamports: denomLamports,
      })

      const tx = new Transaction().add(withdrawIx, sweepIx)
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
      tx.feePayer = kp.publicKey
      tx.sign(kp, tempKp)
      await conn.sendRawTransaction(tx.serialize())

      notify(t('wallet.zkidWithdrawOk'))
      setZkDeposits(prev => prev.filter((_, i) => i !== idx))
      fetchBalance()
    } catch (e) { notify(e.message || t('wallet.zkidWithdrawFailed'), 'err') }
    finally { setZkWithdrawing(null) }
  }, [zkDeposits, myZkName, wallet, rpcUrl, notify, t, fetchBalance])

  const handleZkDepositClick = useCallback(() => {
    if (!zkName.trim()) { notify(t('wallet.fillFields'), 'err'); return }
    setConfirmZkSend(true)
  }, [zkName, notify, t])

  // ── Buy Compute (x402) handlers ────────────────────────────
  const fetchHubConfig = useCallback(async () => {
    try {
      const res = await fetch(`${MODEL_HUB_BASE}/402`)
      const text = await res.text()
      const json = JSON.parse(text)
      const x = json.x402
      if (!x?.address || !x?.rate) throw new Error('Invalid x402 response')
      setHubConfig({ address: x.address, rate: x.rate, endpoints: x.endpoints, models: x.models || [] })
    } catch (e) {
      console.error('fetchHubConfig failed:', e)
      setHubConfig(null)
    }
  }, [])

  const signMessage = useCallback((kp, message) => {
    const msgBytes = new TextEncoder().encode(message)
    const sig = nacl.sign.detached(msgBytes, kp.secretKey)
    return bs58.encode(sig)
  }, [])

  const fetchHubInfo = useCallback(async () => {
    if (!wallet || !hubConfig) return
    setHubInfo('loading')
    try {
      const kp = storeToKeypair(wallet)
      const ts = Math.floor(Date.now() / 1000)
      const sign = signMessage(kp, `info:${ts}`)
      const infoPath = hubConfig.endpoints.info.path
      const url = `${MODEL_HUB_BASE}${infoPath}?address=${kp.publicKey.toBase58()}&ts=${ts}&sign=${sign}`
      const res = await fetch(url)
      if (!res.ok) { setHubInfo('none'); return }
      const json = await res.json()
      setHubInfo(json.data)
    } catch { setHubInfo('none') }
  }, [wallet, hubConfig, signMessage])

  useEffect(() => {
    if (showTransfer && transferTab === 'compute') {
      if (!hubConfig) fetchHubConfig()
    }
  }, [showTransfer, transferTab, hubConfig, fetchHubConfig])

  useEffect(() => {
    if (showTransfer && transferTab === 'compute' && hubConfig && wallet) fetchHubInfo()
  }, [showTransfer, transferTab, hubConfig, wallet])

  const handleBuyClick = useCallback(() => {
    if (!buyAmount) { notify(t('wallet.fillFields'), 'err'); return }
    const nara = parseFloat(buyAmount)
    if (isNaN(nara) || nara <= 0) { notify(t('wallet.invalidAmount'), 'err'); return }
    if (hubConfig && nara / hubConfig.rate < 1) { notify(t('wallet.buyMinimum'), 'err'); return }
    setConfirmBuy(true)
  }, [buyAmount, hubConfig, notify, t])

  const handleBuyCompute = useCallback(async () => {
    setConfirmBuy(false)
    if (!buyAmount || !hubConfig) return
    const lamports = Math.round(parseFloat(buyAmount) * LAMPORTS_PER_SOL)
    if (isNaN(lamports) || lamports <= 0) return
    setBuying(true); setBuyResult(null)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const kp = storeToKeypair(wallet)
      const chargeAddr = new PublicKey(hubConfig.address)

      // 1. Transfer NARA to charge address
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: chargeAddr, lamports }))
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
      tx.feePayer = kp.publicKey
      tx.sign(kp)
      const sig = await conn.sendRawTransaction(tx.serialize())

      // 2. Poll for confirmation
      for (let i = 0; i < 60; i++) {
        const { value } = await conn.getSignatureStatuses([sig])
        const status = value?.[0]
        if (status?.err) throw new Error('Transaction failed')
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break
        if (i === 59) throw new Error('Transaction confirmation timeout')
        await new Promise(r => setTimeout(r, 2000))
      }

      // 3. Sign and call charge endpoint
      const ts = Math.floor(Date.now() / 1000)
      const sign = signMessage(kp, `${sig}:${ts}`)
      const chargePath = hubConfig.endpoints.charge.path
      const chargeUrl = `${MODEL_HUB_BASE}${chargePath}?address=${kp.publicKey.toBase58()}&tx=${sig}&ts=${ts}&sign=${sign}`
      const chargeRes = await fetch(chargeUrl)
      const chargeJson = await chargeRes.json()

      if (!chargeRes.ok || !chargeJson.success) {
        throw new Error(chargeJson.error || chargeJson.message || 'Charge failed')
      }

      setBuyResult({ ok: true, data: chargeJson.data })
      setBuyAmount('')
      fetchBalance()
      fetchHubInfo()
    } catch (e) {
      setBuyResult({ ok: false, error: e.message || t('wallet.buyFailed') })
    } finally { setBuying(false) }
  }, [buyAmount, hubConfig, wallet, rpcUrl, fetchBalance, fetchHubInfo, signMessage, t])

  const handleSendClick = useCallback(() => {
    if (!toAddr || !amount) { notify(t('wallet.fillFields'), 'err'); return }
    const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL)
    if (isNaN(lamports) || lamports <= 0) { notify(t('wallet.invalidAmount'), 'err'); return }
    setConfirmSend(true)
  }, [toAddr, amount, notify, t])

  const handleSend = useCallback(async () => {
    setConfirmSend(false)
    if (!toAddr || !amount) return
    const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL)
    if (isNaN(lamports) || lamports <= 0) return
    setSending(true); setTxResult(null)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const kp = storeToKeypair(wallet)
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(toAddr), lamports }))
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
      tx.feePayer = kp.publicKey
      tx.sign(kp)
      const sig = await conn.sendRawTransaction(tx.serialize())
      // Poll for confirmation instead of using WebSocket-based confirmTransaction
      for (let i = 0; i < 60; i++) {
        const { value } = await conn.getSignatureStatuses([sig])
        const status = value?.[0]
        if (status?.err) throw new Error('Transaction failed')
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break
        if (i === 59) throw new Error('Transaction confirmation timeout')
        await new Promise(r => setTimeout(r, 2000))
      }
      setTxResult({ ok: true, sig })
      setToAddr(''); setAmount(''); fetchBalance()
    } catch (e) {
      setTxResult({ ok: false, error: e.message || t('wallet.transferFailed') })
    } finally { setSending(false) }
  }, [toAddr, amount, wallet, rpcUrl, fetchBalance, notify, t])

  // No wallet — show create/import
  if (tab === 'main' && !wallet) {
    return (
      <main className="page">
        <h1 className="page-title">{t('wallet.title')}</h1>
        <p className="page-sub">{t('wallet.subtitle')}</p>
        <div className="wallet-empty">
          <div className="wallet-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <p className="wallet-empty-text">{t('wallet.noWallet')}</p>
          <div className="wallet-empty-btns">
            <button className="btn btn-primary btn-lg" onClick={handleCreate}>{t('wallet.create')}</button>
            <button className="btn btn-ghost" onClick={() => setTab('import')}>{t('wallet.importExisting')}</button>
          </div>
        </div>
        {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      </main>
    )
  }

  if (tab === 'create') {
    return (
      <main className="page">
        <h1 className="page-title">{t('wallet.newTitle')}</h1>
        <p className="page-sub">{t('wallet.saveSeed')}</p>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">{t('wallet.secretPhrase')}</div>
          <div className="mnemonic-grid">
            {newMnemonic.split(' ').map((word, i) => (
              <div key={i} className="mnemonic-word">
                <span className="mnemonic-idx">{i + 1}</span><span>{word}</span>
              </div>
            ))}
          </div>
          <p className="wallet-warn">{t('wallet.seedWarn')}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => { setTab('main'); setNewMnemonic('') }}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleConfirmCreate}>{t('wallet.iSaved')}</button>
        </div>
        {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      </main>
    )
  }

  if (tab === 'import') {
    return (
      <main className="page">
        <h1 className="page-title">{t('wallet.importTitle')}</h1>
        <p className="page-sub">{t('wallet.importSub')}</p>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="import-tabs">
            <button className={`import-tab ${importMode === 'mnemonic' ? 'active' : ''}`} onClick={() => setImportMode('mnemonic')}>{t('wallet.mnemonic')}</button>
            <button className={`import-tab ${importMode === 'privkey' ? 'active' : ''}`} onClick={() => setImportMode('privkey')}>{t('wallet.privkey')}</button>
          </div>
          <div className="input-group" style={{ marginTop: 16 }}>
            <label className="input-label">{importMode === 'mnemonic' ? t('wallet.mnemonicHint') : t('wallet.privkeyHint')}</label>
            <textarea className="input" rows={importMode === 'mnemonic' ? 3 : 2}
              placeholder={importMode === 'mnemonic' ? 'word1 word2 word3 …' : 'Base58 private key'}
              value={inputVal} onChange={e => setInputVal(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setTab('main')}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleImport}>{t('wallet.importTitle')} →</button>
        </div>
        {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      </main>
    )
  }

  // Has wallet — show wallet info (no delete, no import another, no show key)
  return (
    <main className="page">
      <h1 className="page-title">{t('wallet.title')}</h1>
      <p className="page-sub">Nara · {truncate(wallet.publicKey)}</p>

      <div className="wallet-hero">
        <div className="wallet-hero-inner">
          <div className="wallet-balance-label">{t('wallet.balance')}</div>
          <div className="wallet-balance-val">
            {loadingBal ? <div className="spinner" /> : balance !== null ? balance.toFixed(6) : '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={fetchBalance}>{t('wallet.refresh')}</button>
            <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => { clearTransferInputs(); setShowTransfer(v => !v) }}>
              {showTransfer ? t('common.cancel') : t('wallet.transfer')}
            </button>
          </div>
        </div>
        <div className="wallet-addr-row">
          <span className="wallet-addr-label">{t('wallet.address')}</span>
          <span className="wallet-addr-val truncate">{wallet.publicKey}</span>
          <button className="btn btn-ghost" style={{ padding: '4px 10px' }}
            onClick={() => { navigator.clipboard.writeText(wallet.publicKey); notify(t('wallet.copied')) }}>
            {t('wallet.copy')}
          </button>
        </div>
      </div>

      {showTransfer && (
        <div className="card" style={{ marginBottom: 16 }}>
          {/* Transfer type tabs */}
          <div className="import-tabs" style={{ marginBottom: 16 }}>
            <button className={`import-tab ${transferTab === 'normal' ? 'active' : ''}`}
              onClick={() => { clearTransferInputs(); setTransferTab('normal') }}>{t('wallet.normalTransfer')}</button>
            <button className={`import-tab ${transferTab === 'private' ? 'active' : ''}`}
              onClick={() => { clearTransferInputs(); setTransferTab('private') }}>{t('wallet.privateTransfer')}</button>
            <button className={`import-tab ${transferTab === 'compute' ? 'active' : ''}`}
              onClick={() => { clearTransferInputs(); setTransferTab('compute') }}>{t('wallet.buyCompute')}</button>
          </div>

          {transferTab === 'normal' && (<>
            <div className="card-title">{t('wallet.sendNara')}</div>
            <div className="input-group" style={{ marginBottom: 10 }}>
              <label className="input-label">{t('wallet.recipient')}</label>
              <input className="input" placeholder="Nara address" value={toAddr} onChange={e => { setToAddr(e.target.value); setTxResult(null) }} />
            </div>
            <div className="input-group" style={{ marginBottom: 10 }}>
              <label className="input-label">{t('wallet.amount')}</label>
              <input className="input" type="number" min="0" step="0.001" placeholder="0.001" value={amount} onChange={e => { setAmount(e.target.value); setTxResult(null) }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleSendClick} disabled={sending}>
                {sending ? <><div className="spinner" />{t('wallet.sending')}</> : t('wallet.send')}
              </button>
            </div>
            {txResult && (
              <div className={`wallet-tx-result ${txResult.ok ? 'wallet-tx-ok' : 'wallet-tx-err'}`}>
                <span className="wallet-tx-icon">{txResult.ok ? '✓' : '✗'}</span>
                <div className="wallet-tx-body">
                  <div>{txResult.ok ? t('wallet.sent') : txResult.error}</div>
                  {txResult.sig && (
                    <a className="wallet-tx-link" href={`https://explorer.nara.build/tx/${txResult.sig}`}
                      target="_blank" rel="noopener noreferrer">
                      TX {truncate(txResult.sig, 8, 8)} ↗
                    </a>
                  )}
                </div>
              </div>
            )}
          </>)}

          {transferTab === 'private' && (<>
            {/* Private Send: deposit to someone's ZK ID */}
            <div className="card-title">{t('wallet.privateDesc')}</div>
            <div className="input-group" style={{ marginBottom: 10 }}>
              <label className="input-label">{t('wallet.zkidName')}</label>
              <input className="input" placeholder={t('wallet.zkidNamePlaceholder')}
                value={zkName} onChange={e => { setZkName(e.target.value); setZkResult(null) }} />
            </div>
            <div className="input-group" style={{ marginBottom: 10 }}>
              <label className="input-label">{t('wallet.denomination')}</label>
              <div className="zk-denom-grid">
                {ZKID_DENOMINATIONS.map(d => (
                  <button key={d.label}
                    className={`zk-denom-btn ${zkDenom === d.value ? 'active' : ''}`}
                    onClick={() => setZkDenom(d.value)}>
                    {d.label} NARA
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleZkDepositClick} disabled={zkDepositing}>
                {zkDepositing ? <><div className="spinner" />{t('wallet.depositing')}</> : t('wallet.depositSend')}
              </button>
            </div>
            {zkResult && (
              <div className={`wallet-tx-result ${zkResult.ok ? 'wallet-tx-ok' : 'wallet-tx-err'}`}>
                <span className="wallet-tx-icon">{zkResult.ok ? '✓' : '✗'}</span>
                <div className="wallet-tx-body">
                  <div>{zkResult.ok ? t('wallet.depositSent') : zkResult.error}</div>
                  {zkResult.sig && (
                    <a className="wallet-tx-link" href={`https://explorer.nara.build/tx/${zkResult.sig}`}
                      target="_blank" rel="noopener noreferrer">
                      TX {truncate(zkResult.sig, 8, 8)} ↗
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* My ZK ID: register + scan + withdraw */}
            <div className="zk-divider" />
            <div className="card-title">{t('wallet.myZkid')}</div>
            <div className="input-group" style={{ marginBottom: 10 }}>
              <label className="input-label">{t('wallet.zkidNameInput')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" style={{ flex: 1 }} placeholder={t('wallet.zkidNameInputPlaceholder')}
                  value={myZkName} onChange={e => setMyZkName(e.target.value)} />
                <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }} onClick={handleCheckMyZkId}>
                  {myZkInfo ? t('wallet.zkidRegistered') : t('wallet.zkidNotRegistered')}
                </button>
              </div>
            </div>

            {!myZkInfo && myZkName.trim() && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button className="btn btn-primary" onClick={handleZkRegister} disabled={zkRegistering}>
                  {zkRegistering ? <><div className="spinner" />{t('wallet.zkidRegistering')}</> : t('wallet.zkidRegister')}
                </button>
              </div>
            )}

            {myZkInfo && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button className="btn btn-ghost" onClick={handleScanDeposits} disabled={zkScanning}>
                    {zkScanning ? <><div className="spinner" />{t('wallet.zkidScanning')}</> : t('wallet.zkidScanDeposits')}
                  </button>
                </div>
                {zkDeposits !== null && (
                  zkDeposits.length === 0 ? (
                    <div className="zk-no-deposits">{t('wallet.zkidNoDeposits')}</div>
                  ) : (
                    <div className="zk-deposit-list">
                      {zkDeposits.map((dep, idx) => {
                        const nara = Number(dep.denomination) / 1e9
                        return (
                          <div key={idx} className="zk-deposit-item">
                            <span className="zk-deposit-amount">{nara} NARA</span>
                            <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => handleWithdraw(idx)}
                              disabled={zkWithdrawing !== null}>
                              {zkWithdrawing === idx
                                ? <><div className="spinner" />{t('wallet.zkidWithdrawing')}</>
                                : t('wallet.zkidWithdraw')}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                )}
              </>
            )}
          </>)}

          {transferTab === 'compute' && (<>
            <div className="card-title">
              {t('wallet.buyComputeDesc')}
              {hubConfig ? (
                <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>({hubConfig.rate} {t('wallet.buyNaraPerCU')})</span>
              ) : (
                <span style={{ opacity: 0.4, fontSize: 12, marginLeft: 8 }}><div className="spinner" style={{ display: 'inline-block', width: 12, height: 12 }} /></span>
              )}
            </div>

            {/* Hub account info */}
            {hubInfo === 'loading' && <div style={{ marginBottom: 10, opacity: 0.6 }}>{t('wallet.hubLoading')}</div>}
            {hubInfo === 'none' && <div style={{ marginBottom: 10, opacity: 0.6 }}>{t('wallet.hubNoAccount')}</div>}
            {hubInfo && hubInfo !== 'loading' && hubInfo !== 'none' && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 12 }}>
                <div><strong>{t('wallet.hubBalance')}:</strong> {hubInfo.balance?.toFixed(4) ?? '—'} CU</div>
                {hubInfo.api_base && <div style={{ marginTop: 4 }}><strong>{t('wallet.apiBase')}:</strong> <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{hubInfo.api_base}</code></div>}
                {hubInfo.api_key && <div style={{ marginTop: 4 }}><strong>{t('wallet.apiKey')}:</strong> <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{hubInfo.api_key}</code></div>}
              </div>
            )}

            {hubInfo && hubInfo !== 'loading' && hubInfo !== 'none' && hubConfig?.models?.length > 0 && (
              <div className="zk-divider" />
            )}

            {hubConfig?.models?.length > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 12 }}>
                <div><strong>{t('wallet.availableModels')}:</strong></div>
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {hubConfig.models.map(m => {
                    const isActive = model.model === m && model.baseUrl === hubInfo?.api_base
                    return (
                      <button key={m} onClick={() => {
                        if (!hubInfo?.api_base || !hubInfo?.api_key) { notify(t('wallet.hubNoAccount'), 'err'); return }
                        updateModel({ ...model, baseUrl: hubInfo.api_base, apiKey: hubInfo.api_key, model: m })
                        setModelOk(false)
                        notify(t('wallet.setAsModel'))
                      }}
                        style={{ padding: '4px 12px', background: isActive ? 'var(--accent)' : 'var(--bg-tertiary)', color: isActive ? 'var(--bg-primary)' : 'inherit', borderRadius: 4, fontSize: 12, border: isActive ? 'none' : '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.15s' }}>
                        {m}{isActive ? ' ✓' : ''}
                      </button>
                    )
                  })}
                </div>
                <div style={{ marginTop: 6, opacity: 0.5, fontSize: 11 }}>{t('wallet.clickModelHint')}</div>
              </div>
            )}

            <div className="input-group" style={{ marginBottom: 10 }}>
              <label className="input-label">{t('wallet.buyAmount')}</label>
              <input className="input" type="number" min="0" step="1" placeholder={hubConfig ? String(Math.ceil(hubConfig.rate)) : '1000'}
                value={buyAmount} onChange={e => { setBuyAmount(e.target.value); setBuyResult(null) }} />
              {buyAmount && hubConfig && (
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.6 }}>
                  ≈ {(parseFloat(buyAmount) / hubConfig.rate).toFixed(4)} CU
                  {parseFloat(buyAmount) / hubConfig.rate < 1 && (
                    <span style={{ color: 'var(--error)', marginLeft: 8 }}>{t('wallet.buyMinimum')}</span>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleBuyClick} disabled={buying || !hubConfig}>
                {buying ? <><div className="spinner" />{t('wallet.buying')}</> : t('wallet.buyBtn')}
              </button>
            </div>
            {buyResult && (
              <div className={`wallet-tx-result ${buyResult.ok ? 'wallet-tx-ok' : 'wallet-tx-err'}`}>
                <span className="wallet-tx-icon">{buyResult.ok ? '✓' : '✗'}</span>
                <div className="wallet-tx-body">
                  {buyResult.ok ? (
                    <>
                      <div>{t('wallet.buySuccess')}</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        {t('wallet.balanceAdded')}: {buyResult.data?.balance_added?.toFixed(4) ?? '—'} CU
                      </div>
                      {buyResult.data?.api_key && (
                        <div style={{ fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>
                          {t('wallet.apiKey')}: <code>{buyResult.data.api_key}</code>
                        </div>
                      )}
                    </>
                  ) : (
                    <div>{buyResult.error}</div>
                  )}
                </div>
              </div>
            )}
          </>)}
        </div>
      )}

      {/* Confirm send modal */}
      {confirmSend && (
        <div className="modal-backdrop" onClick={() => setConfirmSend(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('wallet.confirmTitle')}</div>
            <p className="modal-body">
              {t('wallet.confirmBody')}<br />
              <strong>{amount} NARA</strong> →<br /><code style={{ fontSize: 11, wordBreak: 'break-all' }}>{toAddr}</code>
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmSend(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleSend}>{t('wallet.confirmSend')}</button>
            </div>
          </div>
        </div>
      )}

      {confirmZkSend && (
        <div className="modal-backdrop" onClick={() => setConfirmZkSend(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('wallet.confirmTitle')}</div>
            <p className="modal-body">
              {t('wallet.confirmBody')}<br />
              <strong>{ZKID_DENOMINATIONS.find(d => d.value === zkDenom)?.label || ''} NARA</strong> → <strong>{zkName.trim()}</strong>
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmZkSend(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleZkDeposit}>{t('wallet.confirmSend')}</button>
            </div>
          </div>
        </div>
      )}

      {confirmBuy && (
        <div className="modal-backdrop" onClick={() => setConfirmBuy(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('wallet.confirmBuy')}</div>
            <p className="modal-body">
              {t('wallet.confirmBuyBody')}<br />
              <strong>{buyAmount} NARA</strong>
              {hubConfig && <> ≈ <strong>{(parseFloat(buyAmount) / hubConfig.rate).toFixed(4)} CU</strong></>}
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmBuy(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleBuyCompute}>{t('wallet.confirmSend')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </main>
  )
}
