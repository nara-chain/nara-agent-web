import { useState, useEffect, useCallback } from 'react'
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
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
  const { wallet, setWallet, model } = useApp()
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
  const [showTransfer, setShowTransfer] = useState(false)
  const [txResult, setTxResult]     = useState(null) // { ok, sig, error }
  const [confirmSend, setConfirmSend] = useState(false)
  const [newMnemonic, setNewMnemonic]   = useState('')

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
            <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => setShowTransfer(v => !v)}>
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

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </main>
  )
}
