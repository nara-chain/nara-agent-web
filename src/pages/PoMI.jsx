import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { useApp, DEFAULT_RPC } from '../store.jsx'
import { useI18n } from '../i18n.jsx'
import {
  fetchQuestAndStatus,
  getBalance,
  generateProof,
  submitAnswerViaRelay,
  submitAnswerDirect,
  parseQuestReward,
} from '../quest.js'
import './PoMI.css'

function pad(n) { return String(n).padStart(2, '0') }

const REWARD_KEY = 'nara_round_reward_v1'
function saveRoundReward(round, rewardNso) {
  try { localStorage.setItem(REWARD_KEY, JSON.stringify({ round, rewardNso })) } catch {}
}
function loadRoundReward(round) {
  try {
    const d = JSON.parse(localStorage.getItem(REWARD_KEY) || '{}')
    return d.round === round ? d.rewardNso : null
  } catch { return null }
}

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
  const [roundStatus, setRoundStatus] = useState(null)

  // Mining flow state
  const [phase, setPhase] = useState('idle') // idle | answering | proving | submitting | result | waiting
  const [status, setStatus] = useState('')
  const [result, setResult] = useState(null)
  const [showModal, setShowModal] = useState(null)

  // Auto-mining
  const [mining, setMining] = useState(false)
  const miningRef = useRef(false)
  const abortRef = useRef(null)
  const timerRef = useRef(null)
  const pollRef = useRef(null)

  const rpcUrl = model.rpcUrl || DEFAULT_RPC

  // Keep miningRef in sync
  useEffect(() => { miningRef.current = mining }, [mining])

  // ── Fetch quest + answer status in one RPC call ────────────
  const fetchQuest = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const conn = new Connection(rpcUrl, 'confirmed')
      const userPubkey = wallet ? new PublicKey(wallet.publicKey) : null
      const { quest: info, roundStatus: rs } = await fetchQuestAndStatus(conn, userPubkey)
      setQuest(info)
      setTimeLeft(Math.max(0, info.timeRemaining))
      // Restore saved reward amount if same round
      if (rs.answered && rs.rewarded) {
        const saved = loadRoundReward(info.round)
        if (saved != null) rs.rewardNso = saved
      }
      setRoundStatus(rs)
    } catch (e) {
      console.error('fetchQuest:', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [rpcUrl, wallet])

  useEffect(() => { fetchQuest() }, [fetchQuest])

  // ── Poll for next round (silent, no loading state) ────────
  const pollNextRound = useCallback(async (currentRound) => {
    const conn = new Connection(rpcUrl, 'confirmed')
    const userPubkey = wallet ? new PublicKey(wallet.publicKey) : null

    while (miningRef.current) {
      await new Promise(r => setTimeout(r, 3000))
      if (!miningRef.current) break
      try {
        const { quest: info, roundStatus: rs } = await fetchQuestAndStatus(conn, userPubkey)
        if (info.round !== currentRound) {
          // New round arrived
          setQuest(info)
          setTimeLeft(Math.max(0, info.timeRemaining))
          setRoundStatus(rs)
          setResult(null)
          return info
        }
      } catch { /* retry silently */ }
    }
    return null
  }, [rpcUrl, wallet])

  // ── Countdown timer ─────────────────────────────────────────
  useEffect(() => {
    if (!quest || quest.expired) return
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          // If not auto-mining, silently refresh after 2s
          if (!miningRef.current) {
            setTimeout(fetchQuest, 2000)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [quest, fetchQuest])

  // ── Wait for round to expire ──────────────────────────────
  const waitForExpiry = useCallback(() => {
    return new Promise((resolve) => {
      const check = () => {
        if (!miningRef.current) { resolve(false); return }
        // Check deadline directly from quest ref won't work due to closure,
        // so we use a polling approach based on the deadline timestamp
        const now = Math.floor(Date.now() / 1000)
        if (now >= questRef.current.deadline) {
          resolve(true)
        } else {
          setTimeout(check, 1000)
        }
      }
      check()
    })
  }, [])

  // Need a ref for quest to avoid stale closures in waitForExpiry
  const questRef = useRef(null)
  useEffect(() => { questRef.current = quest }, [quest])

  // ── Single mining run for one round ───────────────────────
  const runOneRound = useCallback(async () => {
    if (!miningRef.current) return
    if (!wallet || !model.baseUrl || !model.apiKey || !model.model) return
    if (!questRef.current || !questRef.current.active) return

    const currentQuest = questRef.current
    const conn = new Connection(rpcUrl, 'confirmed')
    const walletKp = Keypair.fromSecretKey(bs58.decode(wallet.secretKey))
    const abort = new AbortController()
    abortRef.current = abort

    setPhase('answering')
    setStatus(t('pomi.aiAnswering'))
    setResult(null)

    try {
      // 1. AI generates answer
      const prompt = `You are answering a blockchain quiz. The question is:\n"${currentQuest.question}"\n\nProvide ONLY the answer text, nothing else. Be concise and precise. One word or short phrase only.`
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
        proof = await generateProof(aiAnswer, currentQuest.answerHash, walletKp.publicKey)
      } catch (e) {
        console.error('Proof failed:', e)
        setPhase('result')
        setResult({ rewarded: false, error: t('pomi.proofFailed') })
        return // Don't retry, wait for next round
      }

      // 3. Check balance → decide direct TX vs relay
      setPhase('submitting')
      const balance = await getBalance(conn, walletKp.publicKey)
      const agentId = model.agentId || ''
      const modelId = model.model || ''
      let txHash

      if (balance > 10_000_000) {
        setStatus(t('pomi.submitting'))
        const { signature } = await submitAnswerDirect(conn, walletKp, proof.solana, agentId, modelId)
        txHash = signature
      } else {
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
      const rNso = reward.rewarded ? reward.rewardNso : 0
      setRoundStatus({ answered: true, rewarded: reward.rewarded, rewardNso: rNso })
      if (reward.rewarded && questRef.current) saveRoundReward(questRef.current.round, rNso)
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
      const sigMatch = e.message?.match(/Check signature ([A-Za-z0-9]{32,})/)
      const errTx = sigMatch?.[1] || null
      const isAlreadyAnswered = e.message?.includes('AlreadyAnswered') || e.message?.includes('6008')
      const msg = isAlreadyAnswered
        ? t('pomi.alreadyAnswered')
        : e.message?.includes('not confirmed') ? t('pomi.submitFailed')
        : e.message || t('pomi.submitFailed')
      if (isAlreadyAnswered) setRoundStatus({ answered: true, rewarded: false })
      setResult({ rewarded: false, error: msg, txHash: errTx })
      // Don't retry, wait for next round
    }
  }, [wallet, model, rpcUrl, t, setModelOk])

  // ── Auto-mining loop ──────────────────────────────────────
  const startMiningLoop = useCallback(async () => {
    while (miningRef.current) {
      const q = questRef.current
      if (!q) { await new Promise(r => setTimeout(r, 2000)); continue }

      // If already answered this round or quest expired → skip to waiting
      if (q.expired || !q.active) {
        // wait then poll
      } else {
        // Check roundStatus from latest state
        const conn = new Connection(rpcUrl, 'confirmed')
        const userPubkey = wallet ? new PublicKey(wallet.publicKey) : null
        try {
          const { roundStatus: rs } = await fetchQuestAndStatus(conn, userPubkey)
          setRoundStatus(rs)
          if (!rs.answered) {
            await runOneRound()
          }
        } catch { /* skip */ }
      }

      if (!miningRef.current) break

      // Wait for round to expire
      setPhase('waiting')
      setStatus(t('pomi.waitingNextRound'))
      const expired = await waitForExpiry()
      if (!expired || !miningRef.current) break

      // Poll for next round (keep current data displayed)
      setStatus(t('pomi.fetchingNextRound'))
      const newQuest = await pollNextRound(questRef.current?.round)
      if (!newQuest || !miningRef.current) break
    }

    // Cleanup when loop exits
    if (!miningRef.current) {
      // Only reset phase if we're still in waiting/working state
      setPhase(prev => prev === 'waiting' ? 'idle' : prev)
    }
  }, [rpcUrl, wallet, runOneRound, pollNextRound, waitForExpiry, t])

  // ── Toggle mining ─────────────────────────────────────────
  const handleToggleMining = useCallback(() => {
    if (!mining) {
      // Start
      if (!wallet) { setShowModal('no-wallet'); return }
      if (!model.baseUrl || !model.apiKey || !model.model) { setShowModal('no-model'); return }
      setMining(true)
      miningRef.current = true
      startMiningLoop()
    } else {
      // Stop
      setMining(false)
      miningRef.current = false
      if (abortRef.current) abortRef.current.abort()
      if (pollRef.current) clearTimeout(pollRef.current)
      setPhase('idle')
      setStatus('')
    }
  }, [mining, wallet, model, startMiningLoop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      miningRef.current = false
      if (abortRef.current) abortRef.current.abort()
      clearInterval(timerRef.current)
    }
  }, [])

  // Timer display
  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60
  const maxTime = quest ? Math.max(quest.timeRemaining, 1) : 1
  const pct = quest ? (timeLeft / maxTime) * 100 : 0
  const urgent = timeLeft <= 30 && timeLeft > 0

  const isWorking = phase === 'answering' || phase === 'proving' || phase === 'submitting'

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
        {roundStatus && (
          roundStatus.answered
            ? <span className={`badge ${roundStatus.rewarded ? 'badge-ok' : 'badge-warn'}`}>
                {t('pomi.roundAnswered')}{roundStatus.rewarded
                  ? ` · ${roundStatus.rewardNso ? `+${roundStatus.rewardNso.toFixed(2)} NARA` : t('pomi.roundRewarded')}`
                  : ` · ${t('pomi.roundNotRewarded')}`}
              </span>
            : <span className="badge badge-off">{t('pomi.roundNotAnswered')}</span>
        )}
      </div>

      {/* Loading / Error */}
      {loading && !quest && (
        <div className="pomi-loading-full">
          <div className="spinner" />
          <span>{t('pomi.fetchingQuest')}</span>
        </div>
      )}

      {error && !loading && !quest && (
        <div className="pomi-error-card">
          <p>{error}</p>
          <button className="btn btn-ghost" onClick={fetchQuest}>{t('pomi.refreshQuest')}</button>
        </div>
      )}

      {/* Quest content */}
      {quest && (
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
            {(isWorking || phase === 'waiting') && (
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
            {mining ? (
              <button className="btn btn-lg btn-mining-active" onClick={handleToggleMining}>
                {t('pomi.stopMining')}
              </button>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={handleToggleMining}>
                {t('pomi.startMining')}
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
