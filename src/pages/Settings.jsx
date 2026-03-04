import { useState, useCallback, useEffect } from 'react'
import { useApp, DEFAULT_RPC, genAgentId } from '../store.jsx'
import { useI18n, LANG_OPTIONS } from '../i18n.jsx'
import './Settings.css'

function Toast({ msg, type, onClose }) {
  useEffect(() => { const id = setTimeout(onClose, 3000); return () => clearTimeout(id) }, [onClose])
  return <div className={`toast toast-${type}`}>{msg}</div>
}

export default function Settings() {
  const { model, updateModel, setModelOk, modelOk } = useApp()
  const { t, lang, setLang } = useI18n()

  const [form, setForm] = useState({
    baseUrl:   model.baseUrl   || '',
    modelName: model.model     || '',
    apiKey:    model.apiKey    || '',
  })
  const [rpcInput, setRpcInput]     = useState(model.rpcUrl || DEFAULT_RPC)
  const [rpcDirty, setRpcDirty]     = useState(false)
  const [agentInput, setAgentInput] = useState(model.agentId || '')
  const [agentDirty, setAgentDirty] = useState(false)
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [toast, setToast]           = useState(null)
  const [showKey, setShowKey]       = useState(false)
  const [dirty, setDirty]           = useState(false)

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

  const handleSaveAgent = useCallback(() => {
    updateModel({ ...model, agentId: agentInput.trim() || model.agentId })
    setAgentDirty(false); notify(t('settings.agentIdSaved'))
  }, [agentInput, model, updateModel, notify, t])

  const handleRegenAgent = useCallback(() => {
    const id = genAgentId()
    setAgentInput(id); setAgentDirty(true)
  }, [])

  return (
    <main className="page settings-page">
      <h1 className="page-title">{t('settings.title')}</h1>
      <p className="page-sub">{t('settings.subtitle')}</p>

      <div style={{ marginBottom: 20 }}>
        <span className={`badge ${modelOk ? 'badge-ok' : 'badge-off'}`}>
          {modelOk ? t('settings.modelOnline') : t('settings.modelOffline')}
        </span>
      </div>

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

      {/* RPC URL */}
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

      {/* Agent ID */}
      <div className="card settings-card">
        <div className="card-title">{t('settings.agentId')}</div>
        <div className="input-group" style={{ marginBottom: 8 }}>
          <div className="input-row">
            <input className="input" type="text" value={agentInput}
              onChange={e => { setAgentInput(e.target.value); setAgentDirty(true) }}
              placeholder="CYBER-WOLF-1234" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }} />
            <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={handleRegenAgent}>
              {t('settings.regenerate')}
            </button>
          </div>
          <span className="settings-hint">{t('settings.agentIdHint')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={handleSaveAgent} disabled={!agentDirty}>{t('settings.save')}</button>
        </div>
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

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </main>
  )
}
