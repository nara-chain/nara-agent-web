import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { useApp, DEFAULT_RPC } from '../store.jsx'
import { useI18n } from '../i18n.jsx'
import {
  getQuestInfo,
  checkAnswered,
  getBalance,
  generateProof,
  submitAnswerViaRelay,
  submitAnswerDirect,
  parseQuestReward,
} from '../quest.js'
import './PoMI.css'

function pad(n) { return String(n).padStart(2, '0') }

function DifficultyBar({ level, t }) {
  const label = level <= 3 ? t('pomi.easy') : level <= 6 ? t('pomi.medium') : level <= 8 ? t('pomi.hard') : t('pomi.expert')
  const color  = level <= 3 ? 'var(--green)' : level <= 6 ? 'var(--amber)' : level <= 8 ? '#ff7d3b' : 'var(--red)'
  return (
    <div className="difficulty-wrap">
      <span className="difficulty-title">{t('pomi.difficulty')}</span>
      <div className="difficulty-pips">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`difficulty-pip ${i < level ? 'on' : ''}`}
            style={i < level ? { background: color, boxShadow: `0 0 6px ${color}` } : {}} />
        ))}
      </div>
      <span className="difficulty-num" style={{ color }}>{level}</span>
      <span className="difficulty-label" style={{ color }}>{label}</span>
    </div>
  )
}

// ── Phase: idle → answering → proving → submitting → result
export default function PoMI() {
  const navigate = useNavigate()
  const { wallet, model, modelOk, setModelOk } = useApp()
  const { t } = useI18n()

  // Quest state
  const [quest, setQuest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [timeLeft, setTimeLeft] = useState(0)

  // Round answered status
  const [roundStatus, setRoundStatus] = useState(null) // null | { answered, rewarded }

  // Mining flow state
  const [phase, setPhase] = useState('idle') // idle | answering | proving | submitting | result
  const [status, setStatus] = useState('')
  const [result, setResult] = useState(null) // { rewarded, rewardNso, winner, txHash, method }
  const [showModal, setShowModal] = useState(null)

  const timerRef = useRef(null)
  const abortRef = useRef(null)

  const rpcUrl = model.rpcUrl || DEFAULT_RPC

  // ── Fetch quest from chain ──────────────────────────────────
  const fetchQuest = useCallback(async () => {
    setLoading(true)
    setError(null)
    setRoundStatus(null)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const info = await getQuestInfo(conn)
      setQuest(info)
      setTimeLeft(Math.max(0, info.timeRemaining))
      // Check if current wallet already answered this round
      if (wallet) {
        const pubkey = new PublicKey(wallet.publicKey)
        const status = await checkAnswered(conn, pubkey, info.round)
        setRoundStatus(status)
      }
    } catch (e) {
      console.error('fetchQuest:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [rpcUrl, wallet])

  useEffect(() => { fetchQuest() }, [fetchQuest])

  // ── Countdown timer ─────────────────────────────────────────
  useEffect(() => {
    if (!quest || quest.expired) return
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          // Auto-refresh when round expires
          setTimeout(fetchQuest, 2000)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [quest, fetchQuest])

  // ── Start mining ────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!wallet) { setShowModal('no-wallet'); return }
    if (!model.baseUrl || !model.apiKey || !model.model) {
      setShowModal('no-model'); return
    }
    if (!quest || !quest.active || quest.expired) return
    if (roundStatus?.answered) return

    const conn = new Connection(rpcUrl, 'confirmed')
    const walletKp = Keypair.fromSecretKey(bs58.decode(wallet.secretKey))
    const abort = new AbortController()
    abortRef.current = abort

    setPhase('answering')
    setStatus(t('pomi.aiAnswering'))
    setResult(null)

    try {
      // 1. AI generates answer
      const prompt = `You are answering a blockchain quiz. The question is:\n"${quest.question}"\n\nProvide ONLY the answer text, nothing else. Be concise and precise. One word or short phrase only.`
      const res = await fetch(`${model.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
        body: JSON.stringify({ model: model.model, messages: [{ role: 'user', content: prompt }], max_tokens: 50 }),
        signal: abort.signal,
      })
      const data = await res.json()
      const aiAnswer = data.choices?.[0]?.message?.content?.trim() ?? ''
      if (!aiAnswer) throw new Error('AI returned empty answer')
      setModelOk(true)

      // 2. Generate ZK proof
      setPhase('proving')
      setStatus(t('pomi.generatingProof'))
      let proof
      try {
        proof = await generateProof(aiAnswer, quest.answerHash, walletKp.publicKey)
      } catch (e) {
        console.error('Proof failed:', e)
        setPhase('result')
        setResult({ rewarded: false, error: t('pomi.proofFailed') })
        return
      }

      // 3. Check balance → decide direct TX vs relay
      setPhase('submitting')
      const balance = await getBalance(conn, walletKp.publicKey)
      const agentId = model.agentId || ''
      const modelId = model.model || ''
      let txHash

      if (balance > 10_000_000) {
        // Has balance → direct transaction
        setStatus(t('pomi.submitting'))
        const { signature } = await submitAnswerDirect(conn, walletKp, proof.solana, agentId, modelId)
        txHash = signature
      } else {
        // No balance → relay
        setStatus(t('pomi.submittingRelay'))
        const { txHash: hash } = await submitAnswerViaRelay(walletKp.publicKey, proof.hex, agentId, modelId)
        txHash = hash
      }

      // 4. Parse reward
      setStatus(t('pomi.checkingReward'))
      let reward
      try {
        reward = await parseQuestReward(conn, txHash)
      } catch {
        reward = { rewarded: false, rewardNso: 0, winner: '' }
      }

      setPhase('result')
      setResult({
        rewarded: reward.rewarded,
        rewardNso: reward.rewardNso,
        winner: reward.winner,
        txHash,
        method: balance > 10_000_000 ? 'direct' : 'relay',
        aiAnswer,
      })
    } catch (e) {
      if (e.name === 'AbortError') return
      console.error('Mining error:', e)
      setPhase('result')
      // Try to extract txHash from error message (confirmation timeout includes signature)
      const sigMatch = e.message?.match(/Check signature ([A-Za-z0-9]{32,})/)
      const errTx = sigMatch?.[1] || txHash || null
      const msg = e.message?.includes('AlreadyAnswered') || e.message?.includes('6008')
        ? t('pomi.alreadyAnswered')
        : e.message?.includes('not confirmed') ? t('pomi.submitFailed')
        : e.message || t('pomi.submitFailed')
      setResult({ rewarded: false, error: msg, txHash: errTx })
    }
  }, [wallet, model, quest, rpcUrl, roundStatus, t, setModelOk])

  const handleNextRound = useCallback(() => {
    setPhase('idle')
    setResult(null)
    setStatus('')
    fetchQuest()
  }, [fetchQuest])

  // Timer display
  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60
  const maxTime = quest ? Math.max(quest.timeRemaining, 1) : 1
  const pct = quest ? (timeLeft / maxTime) * 100 : 0
  const urgent = timeLeft <= 30 && timeLeft > 0

  return (
    <main className="page pomi-page">
      <h1 className="page-title">PoMI</h1>
      <p className="page-sub">{t('pomi.subtitle')}</p>

      {/* Status bar */}
      <div className="pomi-status-row">
        <span className={`badge ${wallet ? 'badge-ok' : 'badge-off'}`}>
          {wallet ? t('pomi.walletOk') : t('pomi.noWallet')}
        </span>
        <span className={`badge ${modelOk ? 'badge-ok' : model.baseUrl ? 'badge-warn' : 'badge-off'}`}>
          {modelOk ? t('pomi.modelOnline') : model.baseUrl ? t('pomi.modelUnverified') : t('pomi.noModel')}
        </span>
        {roundStatus && phase === 'idle' && (
          roundStatus.answered
            ? <span className={`badge ${roundStatus.rewarded ? 'badge-ok' : 'badge-warn'}`}>
                {t('pomi.roundAnswered')}{roundStatus.rewarded ? ` · ${t('pomi.roundRewarded')}` : ` · ${t('pomi.roundNotRewarded')}`}
              </span>
            : <span className="badge badge-off">{t('pomi.roundNotAnswered')}</span>
        )}
        {phase === 'result' && result && result.rewarded && (
          <span className="badge badge-ok">
            +{result.rewardNso.toFixed(2)} NARA
          </span>
        )}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="pomi-loading-full">
          <div className="spinner" />
          <span>{t('pomi.fetchingQuest')}</span>
        </div>
      )}

      {error && !loading && (
        <div className="pomi-error-card">
          <p>{error}</p>
          <button className="btn btn-ghost" onClick={fetchQuest}>{t('pomi.refreshQuest')}</button>
        </div>
      )}

      {/* Quest content */}
      {quest && !loading && !error && (
        <>
          {/* Timer ring */}
          <div className={`pomi-timer-wrap ${urgent ? 'urgent' : ''}`}>
            <svg className="pomi-ring" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" className="ring-bg" />
              <circle
                cx="60" cy="60" r="54"
                className="ring-fg"
                strokeDasharray={`${2 * Math.PI * 54}`}
                strokeDashoffset={`${2 * Math.PI * 54 * (1 - pct / 100)}`}
              />
            </svg>
            <div className="pomi-time-display">
              <span className="pomi-time-num">{pad(mins)}:{pad(secs)}</span>
              <span className="pomi-time-label">{t('pomi.remaining')}</span>
            </div>
          </div>

          {/* Reward info */}
          <div className="pomi-reward-row">
            <div className="pomi-reward-item">
              <span className="pomi-reward-value">{quest.rewardPerWinner.toFixed(2)}</span>
              <span className="pomi-reward-label">NARA {t('pomi.perWinner')}</span>
            </div>
            <div className="pomi-reward-item">
              <span className="pomi-reward-value">{quest.remainingSlots}</span>
              <span className="pomi-reward-label">{t('pomi.slots')}</span>
            </div>
          </div>

          {/* Question card */}
          <div className="pomi-question-card">
            <div className="pomi-question-header">
              <div className="card-title" style={{ marginBottom: 0 }}>
                {t('pomi.question')} · {t('pomi.round')} #{quest.round}
              </div>
              <DifficultyBar level={quest.difficulty} t={t} />
            </div>
            <p className="pomi-q-text">{quest.question}</p>

            {/* Mining progress */}
            {phase !== 'idle' && phase !== 'result' && (
              <div className="pomi-mining-status">
                <div className="spinner" />
                <span>{status}</span>
              </div>
            )}

            {/* Result */}
            {phase === 'result' && result && (
              <div className={`pomi-result ${result.rewarded ? 'pomi-result-ok' : 'pomi-result-err'}`}>
                {result.rewarded ? (
                  <>
                    <span className="pomi-result-icon">✓</span>
                    <div>
                      <div>{t('pomi.rewarded')} <strong>{result.rewardNso.toFixed(2)} NARA</strong></div>
                      {result.winner && <div className="pomi-result-detail">{t('pomi.winner')} {result.winner}</div>}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="pomi-result-icon">✗</span>
                    <div>{result.error || t('pomi.noReward')}</div>
                  </>
                )}
                {result.txHash && (
                  <a className="pomi-tx-badge" href={`https://explorer.nara.build/tx/${result.txHash}`}
                    target="_blank" rel="noopener noreferrer">
                    TX ↗
                  </a>
                )}
              </div>
            )}

            {result?.aiAnswer && (
              <div className="pomi-ai-answer">
                <span className="pomi-ai-answer-label">AI:</span> {result.aiAnswer}
              </div>
            )}
          </div>

          {/* CTA */}
          <div className="pomi-cta">
            {phase === 'idle' && !quest.expired && quest.active && !roundStatus?.answered && (
              <button className="btn btn-primary btn-lg" onClick={handleStart}>
                {t('pomi.startMining')}
              </button>
            )}
            {phase === 'idle' && !quest.expired && quest.active && roundStatus?.answered && (
              <button className="btn btn-ghost btn-lg" disabled>
                {t('pomi.alreadyAnswered')}
              </button>
            )}
            {phase === 'idle' && (quest.expired || !quest.active) && (
              <button className="btn btn-ghost btn-lg" onClick={fetchQuest}>
                {t('pomi.refreshQuest')}
              </button>
            )}
            {phase === 'result' && (
              <button className="btn btn-ghost btn-lg" onClick={handleNextRound}>
                {t('pomi.nextRound')}
              </button>
            )}
          </div>
        </>
      )}

      {/* Modals */}
      {showModal === 'no-wallet' && (
        <div className="modal-backdrop" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('pomi.noWalletTitle')}</div>
            <p className="modal-body">{t('pomi.noWalletBody')}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowModal(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={() => { setShowModal(null); navigate('/wallet') }}>
                {t('pomi.createWallet')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal === 'no-model' && (
        <div className="modal-backdrop" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('pomi.noModelTitle')}</div>
            <p className="modal-body">{t('pomi.noModelBody')}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowModal(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={() => { setShowModal(null); navigate('/settings') }}>
                {t('pomi.configureModel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
