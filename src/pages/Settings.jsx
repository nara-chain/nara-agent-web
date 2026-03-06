import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Connection, Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { useApp, DEFAULT_RPC, DEFAULT_TESTNET_RPC, DEFAULT_TESTNET_RELAY, genAgentId } from '../store.jsx'
import { IS_TESTNET } from '../constants.js'
import { useI18n, LANG_OPTIONS } from '../i18n.jsx'
import { registerAgent, checkAgentRegistered } from '../quest.js'
import './Settings.css'

function Toast({ msg, type, onClose }) {
  useEffect(() => { const id = setTimeout(onClose, 3000); return () => clearTimeout(id) }, [onClose])
  return <div className={`toast toast-${type}`}>{msg}</div>
}

export default function Settings() {
  const { wallet, model, updateModel, setModelOk, modelOk, clearWallet, rpcUrl } = useApp()
  const { t, lang, setLang } = useI18n()

  const devMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('dev') === 'true'
  }, [])

  const [form, setForm] = useState({
    baseUrl:   model.baseUrl   || '',
    modelName: model.model     || '',
    apiKey:    model.apiKey    || '',
  })
  const [rpcInput, setRpcInput]     = useState(model.rpcUrl || DEFAULT_RPC)
  const [rpcDirty, setRpcDirty]     = useState(false)
  const [testnetRpc, setTestnetRpc] = useState(model.testnetRpcUrl || DEFAULT_TESTNET_RPC)
  const [testnetRelay, setTestnetRelay] = useState(model.testnetRelayUrl || DEFAULT_TESTNET_RELAY)
  const [testnetDirty, setTestnetDirty] = useState(false)
  const [agentInput, setAgentInput] = useState(model.agentId || '')
  const [agentRegistered, setAgentRegistered] = useState(!!model.agentRegistered)
  const [registering, setRegistering] = useState(false)
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [toast, setToast]           = useState(null)
  const [showKey, setShowKey]       = useState(false)
  const [dirty, setDirty]           = useState(false)

  // Private key display
  const [showPrivKey, setShowPrivKey] = useState(false)

  // Clear data modal
  const [clearModal, setClearModal]     = useState(null) // null | 'choose' | 'confirm-wallet' | 'confirm-all'
  const [countdown, setCountdown]       = useState(0)
  const countdownRef = useRef(null)

  const notify = useCallback((msg, type = 'ok') => setToast({ msg, type }), [])

  const set = useCallback((key, val) => {
    setForm(f => ({ ...f, [key]: val }))
    setDirty(true); setTestResult(null)
  }, [])

  const handleSave = useCallback(() => {
    if (!form.baseUrl || !form.modelName || !form.apiKey) { notify(t('settings.allRequired'), 'err'); return }
    updateModel({ ...model, baseUrl: form.baseUrl, model: form.modelName, apiKey: form.apiKey })
    setDirty(false); notify(t('settings.saved'))
  }, [form, model, updateModel, notify, t])

  const handleTest = useCallback(async () => {
    if (!form.baseUrl || !form.modelName || !form.apiKey) { notify(t('settings.fillFirst'), 'err'); return }
    updateModel({ ...model, baseUrl: form.baseUrl, model: form.modelName, apiKey: form.apiKey })
    setDirty(false); setTesting(true); setTestResult(null)
    const start = Date.now()
    try {
      const url = `${form.baseUrl.replace(/\/$/, '')}/chat/completions`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${form.apiKey}` },
        body: JSON.stringify({ model: form.modelName, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 10 }),
      })
      const latency = Date.now() - start
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `HTTP ${res.status}`) }
      const data = await res.json()
      const reply = data.choices?.[0]?.message?.content ?? ''
      setTestResult({ ok: true, msg: `"${reply.trim()}"`, latency }); setModelOk(true)
      notify(t('settings.connSuccess'))
    } catch (e) {
      setTestResult({ ok: false, msg: e.message || t('settings.connFailed') }); setModelOk(false)
      notify(e.message || t('settings.connFailed'), 'err')
    } finally { setTesting(false) }
  }, [form, model, updateModel, setModelOk, notify, t])

  const handleSaveRpc = useCallback(() => {
    updateModel({ ...model, rpcUrl: rpcInput.trim() || DEFAULT_RPC })
    setRpcDirty(false); notify(t('settings.rpcSaved'))
  }, [rpcInput, model, updateModel, notify, t])

  const handleResetRpc = useCallback(() => {
    setRpcInput(DEFAULT_RPC)
    updateModel({ ...model, rpcUrl: DEFAULT_RPC })
    setRpcDirty(false); notify(t('settings.rpcSaved'))
  }, [model, updateModel, notify, t])

  const handleRegisterAgent = useCallback(async () => {
    const id = agentInput.trim()
    if (!id) return
    if (!wallet) { notify(t('settings.noWalletForRegister'), 'err'); return }

    setRegistering(true)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const walletKp = Keypair.fromSecretKey(bs58.decode(wallet.secretKey))
      await registerAgent(conn, walletKp, id)
      updateModel({ ...model, agentId: id, agentRegistered: true })
      setAgentRegistered(true)
      notify(t('settings.registerSuccess'))
    } catch (e) {
      console.error('Register agent error:', e)
      notify(`${t('settings.registerFailed')}: ${e.message}`, 'err')
    } finally {
      setRegistering(false)
    }
  }, [agentInput, wallet, model, updateModel, notify, t])

  const handleRegenAgent = useCallback(() => {
    if (agentRegistered) return
    const id = genAgentId()
    setAgentInput(id)
  }, [agentRegistered])

  // Check if agent is already registered on-chain on mount
  useEffect(() => {
    if (model.agentRegistered || !model.agentId) return
    const conn = new Connection(rpcUrl, 'confirmed')
    checkAgentRegistered(conn, model.agentId).then(registered => {
      if (registered) {
        updateModel({ ...model, agentRegistered: true })
        setAgentRegistered(true)
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveTestnet = useCallback(() => {
    updateModel({ ...model, testnetRpcUrl: testnetRpc.trim() || DEFAULT_TESTNET_RPC, testnetRelayUrl: testnetRelay.trim() || DEFAULT_TESTNET_RELAY })
    setTestnetDirty(false)
    notify(t('settings.saved'))
  }, [testnetRpc, testnetRelay, model, updateModel, notify, t])

  // Clear data flow
  const startCountdown = useCallback((mode) => {
    setClearModal(mode)
    setCountdown(5)
    clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
  }, [])

  const handleClearConfirm = useCallback(() => {
    if (clearModal === 'confirm-wallet') {
      clearWallet()
      notify(t('settings.walletCleared'))
    } else if (clearModal === 'confirm-all') {
      localStorage.clear()
      window.location.reload()
    }
    setClearModal(null)
    clearInterval(countdownRef.current)
  }, [clearModal, clearWallet, notify, t])

  useEffect(() => {
    return () => clearInterval(countdownRef.current)
  }, [])

  return (
    <main className="page settings-page">
      <h1 className="page-title">{t('settings.title')}</h1>
      <p className="page-sub">{t('settings.subtitle')}</p>

      {/* Language */}
      <div className="card settings-card">
        <div className="card-title">{t('settings.language')}</div>
        <div className="lang-grid">
          {LANG_OPTIONS.map(opt => (
            <button key={opt.code} className={`lang-btn ${lang === opt.code ? 'active' : ''}`} onClick={() => setLang(opt.code)}>
              <span className="lang-flag">{opt.flag}</span>
              <span className="lang-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* RPC URL — dev mode only */}
      {devMode && (
        <div className="card settings-card">
          <div className="card-title">{t('settings.rpc')}</div>
          <div className="input-group" style={{ marginBottom: 8 }}>
            <div className="input-row">
              <input className="input" type="url" value={rpcInput}
                onChange={e => { setRpcInput(e.target.value); setRpcDirty(true) }}
                placeholder={DEFAULT_RPC} />
              <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={handleResetRpc}>
                {t('settings.resetDefault')}
              </button>
            </div>
            <span className="settings-hint">{t('settings.rpcHint')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleSaveRpc} disabled={!rpcDirty}>{t('settings.save')}</button>
          </div>
        </div>
      )}

      {/* Testnet URLs — visible when IS_TESTNET and dev mode */}
      {IS_TESTNET && devMode && (
        <div className="card settings-card">
          <div className="card-title">{t('settings.testnet')}</div>
          <div className="settings-fields">
            <div className="input-group">
              <label className="input-label">{t('settings.testnetRpc')}</label>
              <input className="input" type="url" value={testnetRpc}
                onChange={e => { setTestnetRpc(e.target.value); setTestnetDirty(true) }}
                placeholder={DEFAULT_TESTNET_RPC} />
            </div>
            <div className="input-group">
              <label className="input-label">{t('settings.testnetRelay')}</label>
              <input className="input" type="url" value={testnetRelay}
                onChange={e => { setTestnetRelay(e.target.value); setTestnetDirty(true) }}
                placeholder={DEFAULT_TESTNET_RELAY} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleSaveTestnet} disabled={!testnetDirty}>{t('settings.save')}</button>
          </div>
        </div>
      )}

      {/* Agent ID */}
      <div className="card settings-card">
        <div className="card-title">{t('settings.agentId')}</div>
        <div className="input-group" style={{ marginBottom: 8 }}>
          <div className="input-row">
            <input className="input" type="text" value={agentInput}
              onChange={e => { if (!agentRegistered) setAgentInput(e.target.value) }}
              readOnly={agentRegistered}
              placeholder="CYBER-WOLF-1234" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', opacity: agentRegistered ? 0.7 : 1 }} />
            {!agentRegistered && (
              <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={handleRegenAgent}>
                {t('settings.regenerate')}
              </button>
            )}
          </div>
          <span className="settings-hint">
            {agentRegistered ? t('settings.agentRegistered') : t('settings.agentIdHint')}
          </span>
        </div>
        {!agentRegistered && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleRegisterAgent}
              disabled={registering || !agentInput.trim()}>
              {registering ? <><div className="spinner" />{t('settings.registering')}</> : t('settings.register')}
            </button>
          </div>
        )}
        {agentRegistered && (
          <div className="settings-registered-badge">
            <span>✓</span> {t('settings.registered')}
          </div>
        )}
      </div>

      {/* AI Model */}
      <div className="card settings-card">
        <div className="card-title">{t('settings.endpoint')}</div>
        <div className="settings-fields">
          <div className="input-group">
            <label className="input-label">{t('settings.baseUrl')}</label>
            <input className="input" type="url" placeholder="https://api.openai.com/v1"
              value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} />
            <span className="settings-hint">{t('settings.expose')} <code>/chat/completions</code></span>
          </div>
          <div className="input-group">
            <label className="input-label">{t('settings.modelId')}</label>
            <input className="input" placeholder="gpt-4o-mini  /  claude-sonnet-4-6  /  …"
              value={form.modelName} onChange={e => set('modelName', e.target.value)} />
          </div>
          <div className="input-group">
            <label className="input-label">{t('settings.apiKey')}</label>
            <div className="input-row">
              <input className="input" type={showKey ? 'text' : 'password'} placeholder="sk-…"
                value={form.apiKey} onChange={e => set('apiKey', e.target.value)} />
              <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => setShowKey(s => !s)}>
                {showKey ? t('settings.hide') : t('settings.show')}
              </button>
            </div>
          </div>
        </div>

        {testResult && (
          <div className={`settings-test-result ${testResult.ok ? 'test-ok' : 'test-err'}`}>
            <span className="settings-test-icon">{testResult.ok ? '✓' : '✗'}</span>
            <div>
              <div className="settings-test-msg">{testResult.msg}</div>
              {testResult.latency && <div className="settings-test-latency">{testResult.latency}ms</div>}
            </div>
          </div>
        )}

        <div className="settings-actions">
          <button className="btn btn-ghost" onClick={handleTest} disabled={testing}>
            {testing ? <><div className="spinner" />{t('settings.testing')}</> : t('settings.testConn')}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!dirty}>{t('settings.save')}</button>
        </div>
      </div>

      {/* Presets */}
      <div className="settings-presets">
        <div className="card-title" style={{ marginBottom: 10 }}>{t('settings.presets')}</div>
        <div className="preset-list">
          {[
            { label: 'OpenAI',         url: 'https://api.openai.com/v1',    model: 'gpt-4o-mini' },
            { label: 'Anthropic',      url: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001' },
            { label: 'Local / Ollama', url: 'http://localhost:11434/v1',    model: 'llama3.2' },
            { label: 'inference.sh',   url: 'https://api.inference.sh/v1', model: 'claude-sonnet-4-6' },
          ].map(p => (
            <button key={p.label} className="preset-btn" onClick={() => {
              setForm(f => ({ ...f, baseUrl: p.url, modelName: p.model }))
              setDirty(true); setTestResult(null)
            }}>
              <span className="preset-label">{p.label}</span>
              <span className="preset-model">{p.model}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Private Key */}
      {wallet && (
        <div className="card settings-card">
          <div className="card-title">{t('settings.privKeyTitle')}</div>
          <p className="settings-hint" style={{ marginBottom: 10 }}>{t('settings.privKeyWarn')}</p>
          {showPrivKey ? (
            <>
              <code className="wallet-secret-key">{wallet.secretKey}</code>
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-ghost" onClick={() => setShowPrivKey(false)}>{t('settings.hidePrivKey')}</button>
              </div>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setShowPrivKey(true)}>{t('settings.showPrivKey')}</button>
          )}
        </div>
      )}

      {/* Clear Data */}
      <div className="card settings-card">
        <div className="card-title">{t('settings.clearData')}</div>
        <p className="settings-hint" style={{ marginBottom: 10 }}>{t('settings.clearDataHint')}</p>
        <button className="btn btn-danger" onClick={() => setClearModal('choose')}>{t('settings.clearData')}</button>
      </div>

      {/* Clear Data Modal — Step 1: Choose */}
      {clearModal === 'choose' && (
        <div className="modal-backdrop" onClick={() => setClearModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('settings.clearData')}</div>
            <p className="modal-body">{t('settings.clearChoose')}</p>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: 8 }}>
              {wallet && (
                <button className="btn btn-danger" style={{ width: '100%' }}
                  onClick={() => startCountdown('confirm-wallet')}>
                  {t('settings.clearWalletOnly')}
                </button>
              )}
              <button className="btn btn-danger" style={{ width: '100%' }}
                onClick={() => startCountdown('confirm-all')}>
                {t('settings.clearAll')}
              </button>
              <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setClearModal(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Data Modal — Step 2: Countdown confirm */}
      {(clearModal === 'confirm-wallet' || clearModal === 'confirm-all') && (
        <div className="modal-backdrop" onClick={() => { setClearModal(null); clearInterval(countdownRef.current) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              {clearModal === 'confirm-wallet' ? t('settings.clearWalletOnly') : t('settings.clearAll')}
            </div>
            <p className="modal-body" style={{ color: 'var(--red)' }}>{t('settings.clearWarn')}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setClearModal(null); clearInterval(countdownRef.current) }}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" disabled={countdown > 0} onClick={handleClearConfirm}>
                {countdown > 0 ? `${t('settings.confirmIn')} ${countdown}s` : t('settings.confirmClear')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </main>
  )
}
