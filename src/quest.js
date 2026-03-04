/**
 * Browser-compatible quest module
 * Adapted from nara-sdk/src/quest.ts — no Node.js fs/path/url imports
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import { Program, AnchorProvider } from '@coral-xyz/anchor'
import naraQuestIdl from '../node_modules/nara-sdk/src/idls/nara_quest.json'

// Anchor browser build doesn't export Wallet — minimal implementation
class NodeWallet {
  constructor(payer) { this.payer = payer; this.publicKey = payer.publicKey }
  async signTransaction(tx) { tx.partialSign(this.payer); return tx }
  async signAllTransactions(txs) { txs.forEach(tx => tx.partialSign(this.payer)); return txs }
}

const QUEST_PROGRAM_ID = 'Quest11111111111111111111111111111111111111'
const RELAY_URL = 'https://quest-api.nara.build'

// ── ZK constants ────────────────────────────────────────────────
const BN254_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n

function toBigEndian32(v) {
  return Buffer.from(v.toString(16).padStart(64, '0'), 'hex')
}

function answerToField(answer) {
  return BigInt('0x' + Buffer.from(answer, 'utf-8').toString('hex')) % BN254_FIELD
}

function hashBytesToFieldStr(hashBytes) {
  return BigInt('0x' + Buffer.from(hashBytes).toString('hex')).toString()
}

function pubkeyToCircuitInputs(pubkey) {
  const bytes = pubkey.toBuffer()
  return {
    lo: BigInt('0x' + bytes.subarray(16, 32).toString('hex')).toString(),
    hi: BigInt('0x' + bytes.subarray(0, 16).toString('hex')).toString(),
  }
}

function proofToSolana(proof) {
  const negY = (y) => toBigEndian32(BN254_FIELD - BigInt(y))
  const be = (s) => toBigEndian32(BigInt(s))
  return {
    proofA: Array.from(Buffer.concat([be(proof.pi_a[0]), negY(proof.pi_a[1])])),
    proofB: Array.from(Buffer.concat([
      be(proof.pi_b[0][1]), be(proof.pi_b[0][0]),
      be(proof.pi_b[1][1]), be(proof.pi_b[1][0]),
    ])),
    proofC: Array.from(Buffer.concat([be(proof.pi_c[0]), be(proof.pi_c[1])])),
  }
}

function proofToHex(proof) {
  const negY = (y) => toBigEndian32(BN254_FIELD - BigInt(y))
  const be = (s) => toBigEndian32(BigInt(s))
  return {
    proofA: Buffer.concat([be(proof.pi_a[0]), negY(proof.pi_a[1])]).toString('hex'),
    proofB: Buffer.concat([
      be(proof.pi_b[0][1]), be(proof.pi_b[0][0]),
      be(proof.pi_b[1][1]), be(proof.pi_b[1][0]),
    ]).toString('hex'),
    proofC: Buffer.concat([be(proof.pi_c[0]), be(proof.pi_c[1])]).toString('hex'),
  }
}

// ── Anchor helpers ──────────────────────────────────────────────
function createProgram(connection, wallet) {
  const idlWithPid = { ...naraQuestIdl, address: QUEST_PROGRAM_ID }
  const provider = new AnchorProvider(
    connection,
    new NodeWallet(wallet),
    { commitment: 'confirmed' }
  )
  anchor.setProvider(provider)
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
    [Buffer.from('quest_winner'), user.toBuffer()],
    pid
  )
  return pda
}

// ── Public API ──────────────────────────────────────────────────

function parsePoolAccount(program, data) {
  const pool = program.coder.accounts.decode('pool', data)
  const now = Math.floor(Date.now() / 1000)
  const deadline = pool.deadline.toNumber()
  const secsLeft = deadline - now
  return {
    active: pool.isActive,
    round: pool.round.toString(),
    questionId: pool.questionId.toString(),
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

function parseWinnerRecord(program, data, currentRound) {
  try {
    const wr = program.coder.accounts.decode('winnerRecord', data)
    if (wr.round.toString() === currentRound) {
      return { answered: true, rewarded: wr.rewarded }
    }
  } catch { /* account doesn't exist or decode fails */ }
  return { answered: false, rewarded: false }
}

/**
 * Fetch quest info + answer status in a single RPC call (getMultipleAccounts)
 * If userPubkey is provided, also checks winner record for current round
 */
export async function fetchQuestAndStatus(connection, userPubkey) {
  const kp = Keypair.generate()
  const program = createProgram(connection, kp)
  const poolPda = getPoolPda()

  const pdas = [poolPda]
  if (userPubkey) pdas.push(getWinnerRecordPda(userPubkey))

  const accounts = await connection.getMultipleAccountsInfo(pdas)

  // Pool account must exist
  if (!accounts[0]) throw new Error('Quest pool account not found')
  // Skip 8-byte discriminator is handled by Anchor coder
  const quest = parsePoolAccount(program, accounts[0].data)

  let roundStatus = { answered: false, rewarded: false }
  if (userPubkey && accounts[1]?.data) {
    roundStatus = parseWinnerRecord(program, accounts[1].data, quest.round)
  }

  return { quest, roundStatus }
}

/**
 * Fetch current quest info from chain (single account)
 */
export async function getQuestInfo(connection) {
  const { quest } = await fetchQuestAndStatus(connection, null)
  return quest
}

/**
 * Check wallet SOL balance (in lamports)
 */
export async function getBalance(connection, pubkey) {
  try {
    return await connection.getBalance(pubkey)
  } catch {
    return 0
  }
}

/**
 * Generate ZK proof for a quest answer (browser-compatible, uses URL for circuit files)
 */
export async function generateProof(answer, answerHash, userPubkey) {
  const snarkjs = await import('snarkjs')
  const answerHashFieldStr = hashBytesToFieldStr(answerHash)
  const { lo, hi } = pubkeyToCircuitInputs(userPubkey)

  const wasmUrl = '/zk/answer_proof.wasm'
  const zkeyUrl = '/zk/answer_proof_final.zkey'

  const result = await snarkjs.groth16.fullProve(
    {
      answer: answerToField(answer).toString(),
      answer_hash: answerHashFieldStr,
      pubkey_lo: lo,
      pubkey_hi: hi,
    },
    wasmUrl,
    zkeyUrl,
  )

  return {
    solana: proofToSolana(result.proof),
    hex: proofToHex(result.proof),
  }
}

/**
 * Submit answer via relay (gasless) — for wallets with no balance
 */
export async function submitAnswerViaRelay(userPubkey, proofHex, agent = '', model = '') {
  const base = RELAY_URL.replace(/\/+$/, '')
  const res = await fetch(`${base}/submit-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: userPubkey.toBase58(),
      proofA: proofHex.proofA,
      proofB: proofHex.proofB,
      proofC: proofHex.proofC,
      agent,
      model,
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error ?? `Relay HTTP ${res.status}`)
  }
  return { txHash: data.txHash }
}

/**
 * Submit answer directly on-chain (requires SOL for gas)
 */
export async function submitAnswerDirect(connection, walletKeypair, proofSolana, agent = '', model = '') {
  const program = createProgram(connection, walletKeypair)
  const tx = await program.methods
    .submitAnswer(proofSolana.proofA, proofSolana.proofB, proofSolana.proofC, agent, model)
    .accounts({ user: walletKeypair.publicKey, payer: walletKeypair.publicKey })
    .signers([walletKeypair])
    .transaction()

  tx.feePayer = walletKeypair.publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  tx.sign(walletKeypair)

  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true })
  // Poll for confirmation (avoid confirmTransaction which uses WebSocket)
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

/**
 * Parse reward info from a transaction signature
 */
export async function parseQuestReward(connection, txSignature, retries = 10) {
  await new Promise(r => setTimeout(r, 2000))

  let txInfo
  for (let i = 0; i < retries; i++) {
    try {
      txInfo = await connection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      if (txInfo) break
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1000))
  }

  if (!txInfo) throw new Error('Failed to fetch transaction details')

  let rewardLamports = 0
  let winner = ''
  const logs = txInfo.meta?.logMessages ?? []
  for (const log of logs) {
    const m = log.match(/reward (\d+) lamports \(winner (\d+\/\d+)\)/)
    if (m) {
      rewardLamports = parseInt(m[1])
      winner = m[2]
      break
    }
  }

  return {
    rewarded: rewardLamports > 0,
    rewardLamports,
    rewardNso: rewardLamports / LAMPORTS_PER_SOL,
    winner,
  }
}
