/**
 * Quest module — browser-compatible wrapper.
 * Uses nara-sdk for: ZK proof generation, agent registry, reward parsing.
 * Keeps local: fetchQuestAndStatus (optimized single RPC), submitAnswerDirect (polling confirmation).
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js'
import { Program, AnchorProvider } from '@coral-xyz/anchor'
import naraQuestIdl from '../node_modules/nara-sdk/src/idls/nara_quest.json'
import {
  generateProof as sdkGenerateProof,
  submitAnswerViaRelay as sdkSubmitAnswerViaRelay,
  parseQuestReward as sdkParseQuestReward,
} from 'nara-sdk/src/quest'
import {
  registerAgent as sdkRegisterAgent,
  registerAgentWithReferral as sdkRegisterAgentWithReferral,
  getAgentRecord,
  getConfig as getAgentRegistryConfig,
  makeLogActivityIx as sdkMakeLogActivityIx,
  makeLogActivityWithReferralIx as sdkMakeLogActivityWithReferralIx,
} from 'nara-sdk/src/agent_registry'

const QUEST_PROGRAM_ID = 'Quest11111111111111111111111111111111111111'

// ── Anchor helpers ──────────────────────────────────────────────
function createProgram(connection, wallet) {
  const idlWithPid = { ...naraQuestIdl, address: QUEST_PROGRAM_ID }
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  return new Program(idlWithPid, provider)
}

function getPoolPda() {
  const pid = new PublicKey(QUEST_PROGRAM_ID)
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('quest_pool')], pid)
  return pda
}

function getWinnerRecordPda(user) {
  const pid = new PublicKey(QUEST_PROGRAM_ID)
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('quest_winner'), user.toBuffer()], pid
  )
  return pda
}

function parsePoolAccount(program, data) {
  const pool = program.coder.accounts.decode('pool', data)
  const now = Math.floor(Date.now() / 1000)
  const deadline = pool.deadline.toNumber()
  const secsLeft = deadline - now
  return {
    active: pool.question.length > 0 && secsLeft > 0,
    round: pool.round.toString(),
    question: pool.question,
    answerHash: Array.from(pool.answerHash),
    rewardPerWinner: pool.rewardPerWinner.toNumber() / LAMPORTS_PER_SOL,
    totalReward: pool.rewardAmount.toNumber() / LAMPORTS_PER_SOL,
    rewardCount: pool.rewardCount,
    winnerCount: pool.winnerCount,
    remainingSlots: Math.max(0, pool.rewardCount - pool.winnerCount),
    difficulty: pool.difficulty,
    deadline,
    timeRemaining: secsLeft,
    expired: secsLeft <= 0,
  }
}

// ── Quest Public API ────────────────────────────────────────────

/**
 * Fetch quest info + answer status in a single RPC call (getMultipleAccounts).
 * This is a browser-optimized version that avoids multiple RPC roundtrips.
 */
export async function fetchQuestAndStatus(connection, userPubkey) {
  const kp = Keypair.generate()
  const program = createProgram(connection, kp)
  const poolPda = getPoolPda()

  const pdas = [poolPda]
  if (userPubkey) pdas.push(getWinnerRecordPda(userPubkey))

  const accounts = await connection.getMultipleAccountsInfo(pdas)
  if (!accounts[0]) throw new Error('Quest pool account not found')
  const quest = parsePoolAccount(program, accounts[0].data)

  let roundStatus = { answered: false }
  if (userPubkey && accounts[1]?.data) {
    try {
      const wr = program.coder.accounts.decode('winnerRecord', accounts[1].data)
      if (wr.round.toString() === quest.round) roundStatus = { answered: true }
    } catch { /* not answered */ }
  }

  return { quest, roundStatus }
}

export async function getBalance(connection, pubkey) {
  try { return await connection.getBalance(pubkey) }
  catch { return 0 }
}

/** Generate ZK proof — delegates to SDK with browser URL paths */
export async function generateProof(answer, answerHash, userPubkey, round) {
  return sdkGenerateProof(answer, answerHash, userPubkey, round, {
    circuitWasmPath: '/zk/answer_proof.wasm',
    zkeyPath: '/zk/answer_proof_final.zkey',
  })
}

/** Submit answer via relay (gasless) */
export { sdkSubmitAnswerViaRelay as submitAnswerViaRelay }

/**
 * Submit answer directly on-chain with polling confirmation (no WebSocket).
 * Optionally appends a logActivity instruction.
 */
export async function submitAnswerDirect(connection, walletKeypair, proofSolana, agent = '', model = '', activityLog = null) {
  const program = createProgram(connection, walletKeypair)

  const submitIx = await program.methods
    .submitAnswer(proofSolana.proofA, proofSolana.proofB, proofSolana.proofC, agent, model)
    .accounts({ user: walletKeypair.publicKey, payer: walletKeypair.publicKey })
    .instruction()

  const tx = new Transaction().add(submitIx)

  if (activityLog) {
    const logIx = await makeLogActivityIx(
      connection, walletKeypair.publicKey,
      activityLog.agentId, activityLog.model, activityLog.activity, activityLog.log,
      activityLog.referralAgentId
    )
    tx.add(logIx)
  }

  tx.feePayer = walletKeypair.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(walletKeypair)

  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  const start = Date.now()
  while (Date.now() - start < 10000) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const { value } = await connection.getSignatureStatuses([signature])
      if (value?.[0]?.confirmationStatus === 'confirmed' || value?.[0]?.confirmationStatus === 'finalized') break
    } catch { /* retry */ }
  }

  return { signature }
}

/** Parse reward info — delegates to SDK */
export { sdkParseQuestReward as parseQuestReward }

// ── Agent Registry (delegated to nara-sdk) ────────────────────

export async function makeLogActivityIx(connection, authority, agentId, model, activity, log, referralAgentId) {
  if (referralAgentId) {
    return sdkMakeLogActivityWithReferralIx(connection, authority, agentId, model, activity, log, referralAgentId)
  }
  return sdkMakeLogActivityIx(connection, authority, agentId, model, activity, log)
}

export async function registerAgent(connection, walletKeypair, agentId, referralAgentId) {
  if (referralAgentId) {
    return sdkRegisterAgentWithReferral(connection, walletKeypair, agentId, referralAgentId)
  }
  return sdkRegisterAgent(connection, walletKeypair, agentId)
}

export { getAgentRegistryConfig as getRegistryConfig }

export async function checkAgentRegistered(connection, agentId) {
  try { await getAgentRecord(connection, agentId); return true }
  catch { return false }
}

export async function getAgentReferral(connection, agentId) {
  try {
    const record = await getAgentRecord(connection, agentId)
    return record.referralId || null
  } catch { return null }
}

export async function getAgentPoints(connection, agentId) {
  try {
    const record = await getAgentRecord(connection, agentId)
    const config = await getAgentRegistryConfig(connection)
    const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID: T22 } = await import('@solana/spl-token')
    const ata = getAssociatedTokenAddressSync(config.pointMint, record.authority, true, T22)
    const ataInfo = await connection.getAccountInfo(ata)
    if (!ataInfo) return 0
    return Number(Buffer.from(ataInfo.data).readBigUInt64LE(64))
  } catch { return 0 }
}
