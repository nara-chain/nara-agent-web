import { useState, useEffect, useCallback } from 'react'
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js'
import * as bip39 from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import bs58 from 'bs58'
import { useApp, DEFAULT_RPC } from '../store.jsx'
import { useI18n } from '../i18n.jsx'
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
  const { wallet, setWallet, clearWallet, model } = useApp()
  const { t } = useI18n()
  const rpcUrl = model.rpcUrl || DEFAULT_RPC

  const [tab, setTab]               = useState('main')
  const [importMode, setImportMode] = useState('mnemonic')
  const [inputVal, setInputVal]     = useState('')
  const [balance, setBalance]       = useState(null)
  const [loadingBal, setLoadingBal] = useState(false)
  const [toast, setToast]           = useState(null)
  const [toAddr, setToAddr]         = useState('')
  const [amount, setAmount]         = useState('')
  const [sending, setSending]       = useState(false)
  const [showTransfer, setShowTransfer]     = useState(false)
  const [showSecret, setShowSecret]         = useState(false)
  const [showConfirmClear, setShowConfirmClear] = useState(false)
  const [newMnemonic, setNewMnemonic]       = useState('')

  const notify = useCallback((msg, type = 'ok') => setToast({ msg, type }), [])

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

  const handleSend = useCallback(async () => {
    if (!toAddr || !amount) { notify(t('wallet.fillFields'), 'err'); return }
    const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL)
    if (isNaN(lamports) || lamports <= 0) { notify(t('wallet.invalidAmount'), 'err'); return }
    setSending(true)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const kp = storeToKeypair(wallet)
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(toAddr), lamports }))
      const sig = await sendAndConfirmTransaction(conn, tx, [kp])
      notify(`Sent! Sig: ${truncate(sig, 8, 8)}`)
      setToAddr(''); setAmount(''); setShowTransfer(false); fetchBalance()
    } catch (e) { notify(e.message || t('wallet.transferFailed'), 'err') }
    finally { setSending(false) }
  }, [toAddr, amount, wallet, rpcUrl, fetchBalance, notify, t])

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

  return (
    <main className="page">
      <h1 className="page-title">{t('wallet.title')}</h1>
      <p className="page-sub">Solana · {truncate(wallet.publicKey)}</p>

      <div className="wallet-hero">
        <div className="wallet-hero-inner">
          <div className="wallet-balance-label">{t('wallet.balance')}</div>
          <div className="wallet-balance-val">
            {loadingBal ? <div className="spinner" /> : balance !== null ? balance.toFixed(6) : '—'}
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 11 }} onClick={fetchBalance}>{t('wallet.refresh')}</button>
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

      <div className="wallet-actions">
        <button className="btn btn-primary" onClick={() => setShowTransfer(v => !v)}>
          {showTransfer ? t('common.cancel') : t('wallet.transfer')}
        </button>
        <button className="btn btn-ghost" onClick={() => setShowSecret(s => !s)}>
          {showSecret ? t('wallet.hideKey') : t('wallet.showKey')}
        </button>
        <button className="btn btn-ghost" onClick={() => setTab('import')}>{t('wallet.importAnother')}</button>
        <button className="btn btn-danger" onClick={() => setShowConfirmClear(true)}>{t('wallet.remove')}</button>
      </div>

      {showTransfer && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">{t('wallet.sendSol')}</div>
          <div className="input-group" style={{ marginBottom: 10 }}>
            <label className="input-label">{t('wallet.recipient')}</label>
            <input className="input" placeholder="Solana public key" value={toAddr} onChange={e => setToAddr(e.target.value)} />
          </div>
          <div className="input-row">
            <div className="input-group">
              <label className="input-label">{t('wallet.amount')}</label>
              <input className="input" type="number" min="0" step="0.001" placeholder="0.001" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={handleSend} disabled={sending} style={{ flexShrink: 0 }}>
              {sending ? <><div className="spinner" />{t('wallet.sending')}</> : t('wallet.send')}
            </button>
          </div>
        </div>
      )}

      {showSecret && (
        <div className="card wallet-secret-card" style={{ marginBottom: 16 }}>
          <div className="card-title">{t('wallet.privKeyTitle')}</div>
          <p className="wallet-warn" style={{ marginBottom: 10 }}>{t('wallet.privKeyWarn')}</p>
          <code className="wallet-secret-key">{wallet.secretKey}</code>
        </div>
      )}

      {showConfirmClear && (
        <div className="modal-backdrop" onClick={() => setShowConfirmClear(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('wallet.removeTitle')}</div>
            <p className="modal-body">{t('wallet.removeBody')}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowConfirmClear(false)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={() => { clearWallet(); setShowConfirmClear(false) }}>{t('wallet.remove')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </main>
  )
}
