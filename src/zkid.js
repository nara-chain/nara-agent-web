/**
 * Browser-compatible ZK ID module
 * Adapted from nara-sdk/src/zkid.ts — no Node.js fs/path/crypto imports
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import * as anchor from '@coral-xyz/anchor'
import { Program, AnchorProvider } from '@coral-xyz/anchor'
import { buildPoseidon as _buildPoseidon } from 'circomlibjs'
import nacl from 'tweetnacl'
import naraZkIdl from '../node_modules/nara-sdk/src/idls/nara_zk.json'

// ── Constants ───────────────────────────────────────────────────
const ZKID_PROGRAM_ID = 'ZKidentity111111111111111111111111111111111'
const BN254_PRIME = 21888242871839275222246405745257275088696311157297823662689037894645226208583n
const MERKLE_LEVELS = 64

const WITHDRAW_WASM = '/zk/withdraw.wasm'
const WITHDRAW_ZKEY = '/zk/withdraw_final.zkey'

export const ZKID_DENOMINATIONS = [
  { label: '1', value: 1_000_000_000n },
  { label: '10', value: 10_000_000_000n },
  { label: '100', value: 100_000_000_000n },
  { label: '1,000', value: 1_000_000_000_000n },
  { label: '10,000', value: 10_000_000_000_000n },
  { label: '100,000', value: 100_000_000_000_000n },
]

// ── Anchor browser wallet shim ──────────────────────────────────
class NodeWallet {
  constructor(payer) { this.payer = payer; this.publicKey = payer.publicKey }
  async signTransaction(tx) { tx.partialSign(this.payer); return tx }
  async signAllTransactions(txs) { txs.forEach(tx => tx.partialSign(this.payer)); return txs }
}

// ── Crypto helpers ──────────────────────────────────────────────
let _poseidon = null
async function getPoseidon() {
  if (!_poseidon) _poseidon = await _buildPoseidon()
  return _poseidon
}

async function poseidonHash(inputs) {
  const poseidon = await getPoseidon()
  const result = poseidon(inputs)
  return poseidon.F.toObject(result)
}

function bigIntToBytes32BE(n) {
  return Buffer.from(n.toString(16).padStart(64, '0'), 'hex')
}

function bytes32ToBigInt(buf) {
  return BigInt('0x' + Buffer.from(buf).toString('hex'))
}

function toBytes32(buf) {
  return Array.from(buf.slice(0, 32))
}

/** SHA-256 using Web Crypto API (browser-compatible) */
async function sha256(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Buffer.from(hash)
}

async function computeNameHash(name) {
  return await sha256('nara-zk:' + name)
}

function denomBuf(denomination) {
  const buf = Buffer.alloc(8)
  let v = BigInt(denomination)
  for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xFFn); v >>= 8n }
  return buf
}

function bnFromBigInt(v) {
  return new anchor.BN(v.toString())
}

function packProof(proof) {
  const ax = BigInt(proof.pi_a[0])
  const ay_neg = BN254_PRIME - BigInt(proof.pi_a[1])
  const proofA = Buffer.concat([bigIntToBytes32BE(ax), bigIntToBytes32BE(ay_neg)])
  const proofB = Buffer.concat([
    bigIntToBytes32BE(BigInt(proof.pi_b[0][1])),
    bigIntToBytes32BE(BigInt(proof.pi_b[0][0])),
    bigIntToBytes32BE(BigInt(proof.pi_b[1][1])),
    bigIntToBytes32BE(BigInt(proof.pi_b[1][0])),
  ])
  const proofC = Buffer.concat([
    bigIntToBytes32BE(BigInt(proof.pi_c[0])),
    bigIntToBytes32BE(BigInt(proof.pi_c[1])),
  ])
  return Buffer.concat([proofA, proofB, proofC])
}

async function buildMerklePath(leafIndex, filledSubtrees, zeros) {
  const pathElements = new Array(MERKLE_LEVELS)
  const pathIndices = new Array(MERKLE_LEVELS)
  let idx = leafIndex
  for (let i = 0; i < MERKLE_LEVELS; i++) {
    const isRight = idx % 2n === 1n
    pathElements[i] = isRight ? bytes32ToBigInt(filledSubtrees[i]) : zeros[i]
    pathIndices[i] = isRight ? 1 : 0
    idx = idx / 2n
  }
  return { pathElements, pathIndices }
}

// ── Anchor helpers ──────────────────────────────────────────────
function createProgram(connection, wallet) {
  const idlWithPid = { ...naraZkIdl, address: ZKID_PROGRAM_ID }
  const provider = new AnchorProvider(connection, new NodeWallet(wallet), { commitment: 'confirmed' })
  anchor.setProvider(provider)
  return new Program(idlWithPid, provider)
}

function createReadProgram(connection) {
  return createProgram(connection, Keypair.generate())
}

// ── PDA helpers ─────────────────────────────────────────────────
const pid = new PublicKey(ZKID_PROGRAM_ID)

function findZkIdPda(nameHashBuf) {
  return PublicKey.findProgramAddressSync([Buffer.from('zk_id'), nameHashBuf], pid)
}
function findInboxPda(nameHashBuf) {
  return PublicKey.findProgramAddressSync([Buffer.from('inbox'), nameHashBuf], pid)
}
function findConfigPda() {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], pid)
}
function findNullifierPda(denominationBN, nullifierHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), denomBuf(denominationBN), nullifierHash], pid
  )
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Derive idSecret from keypair + name (browser-compatible)
 * Ed25519 sign("nara-zk:idsecret:v1:{name}") → SHA256 → mod BN254_PRIME
 */
export async function deriveIdSecret(keypair, name) {
  const message = new TextEncoder().encode(`nara-zk:idsecret:v1:${name}`)
  const sig = nacl.sign.detached(message, keypair.secretKey)
  const digest = await sha256(sig)
  const n = BigInt('0x' + digest.toString('hex'))
  return (n % (BN254_PRIME - 1n)) + 1n
}

/** Check if a PublicKey is valid as recipient (< BN254 field prime) */
export function isValidRecipient(pubkey) {
  return bytes32ToBigInt(Buffer.from(pubkey.toBytes())) < BN254_PRIME
}

/** Generate a random Keypair whose public key is a valid BN254 field element */
export function generateValidRecipient() {
  for (let i = 0; i < 1000; i++) {
    const kp = Keypair.generate()
    if (isValidRecipient(kp.publicKey)) return kp
  }
  throw new Error('Could not generate valid recipient after 1000 tries')
}

/** Fetch ZK ID account info. Returns null if not exists. */
export async function getZkIdInfo(connection, name) {
  const program = createReadProgram(connection)
  const nameHashBuf = await computeNameHash(name)
  const [zkIdPda] = findZkIdPda(nameHashBuf)
  try {
    const data = await program.account.zkIdAccount.fetch(zkIdPda)
    return {
      nameHash: Array.from(data.nameHash),
      idCommitment: Array.from(data.idCommitment),
      depositCount: data.depositCount,
      commitmentStartIndex: data.commitmentStartIndex,
    }
  } catch { return null }
}

/** Fetch ZK ID config (fee amount) */
export async function getZkIdConfig(connection) {
  const [configPda] = findConfigPda()
  const info = await connection.getAccountInfo(configPda)
  if (!info) throw new Error('ZK ID config not found')
  const buf = Buffer.from(info.data)
  let offset = 8
  const admin = new PublicKey(buf.subarray(offset, offset + 32)); offset += 32
  const feeRecipient = new PublicKey(buf.subarray(offset, offset + 32)); offset += 32
  const feeAmount = Number(buf.readBigUInt64LE(offset))
  return { admin, feeRecipient, feeAmount }
}

/** Register a new ZK ID on-chain */
export async function createZkId(connection, payer, name, idSecret) {
  const program = createProgram(connection, payer)
  const nameHashBuf = await computeNameHash(name)
  const idCommitment = await poseidonHash([idSecret])
  const idCommitmentBuf = bigIntToBytes32BE(idCommitment)

  const [configPda] = findConfigPda()
  const config = await program.account.configAccount.fetch(configPda)

  return await program.methods
    .register(toBytes32(nameHashBuf), toBytes32(idCommitmentBuf))
    .accounts({ payer: payer.publicKey, feeRecipient: config.feeRecipient })
    .rpc()
}

/** Deposit NARA into a named ZK ID (anyone can deposit knowing just the name) */
export async function deposit(connection, payer, name, denomination) {
  const program = createProgram(connection, payer)
  const nameHashBuf = await computeNameHash(name)
  return await program.methods
    .deposit(toBytes32(nameHashBuf), bnFromBigInt(denomination))
    .accounts({ depositor: payer.publicKey })
    .rpc()
}

/** Scan claimable (unspent) deposits for a ZK ID */
export async function scanClaimableDeposits(connection, name, idSecret) {
  const program = createReadProgram(connection)
  const nameHashBuf = await computeNameHash(name)
  const [zkIdPda] = findZkIdPda(nameHashBuf)
  const [inboxPda] = findInboxPda(nameHashBuf)

  const zkId = await program.account.zkIdAccount.fetch(zkIdPda)
  const inbox = await program.account.inboxAccount.fetch(inboxPda)

  const depositCount = zkId.depositCount
  const commitmentStart = zkId.commitmentStartIndex
  const count = inbox.count
  const head = inbox.head

  const entries = []
  for (let i = 0; i < count; i++) {
    const pos = ((head - count + i) % 64 + 64) % 64
    const entry = inbox.entries[pos]
    entries.push({
      leafIndex: BigInt(entry.leafIndex.toString()),
      denomination: BigInt(entry.denomination.toString()),
    })
  }

  const startDepositIndex = depositCount - count
  const claimable = []
  for (let i = 0; i < entries.length; i++) {
    const depositIndex = startDepositIndex + i
    if (depositIndex < commitmentStart) continue

    const { leafIndex, denomination } = entries[i]
    const nullifierHash_bi = await poseidonHash([idSecret, BigInt(depositIndex)])
    const nullifierHashBuf = bigIntToBytes32BE(nullifierHash_bi)
    const [nullifierPda] = findNullifierPda(denomination, nullifierHashBuf)
    const nullifierInfo = await connection.getAccountInfo(nullifierPda)

    if (nullifierInfo === null) {
      claimable.push({ leafIndex, depositIndex, denomination })
    }
  }
  return claimable
}

/** Withdraw a deposit anonymously using ZK proof */
export async function withdraw(connection, payer, name, idSecret, depositInfo, recipient) {
  if (!isValidRecipient(recipient)) {
    throw new Error('Recipient pubkey is >= BN254 field prime')
  }

  const program = createProgram(connection, payer)
  const denominationBN = bnFromBigInt(depositInfo.denomination)

  // Fetch Merkle tree state
  const [treePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('tree'), denomBuf(depositInfo.denomination)], pid
  )
  const treeData = await program.account.merkleTreeAccount.fetch(treePda)
  const rootIdx = treeData.currentRootIndex
  const root = Buffer.from(treeData.roots[rootIdx])
  const filledSubtrees = treeData.filledSubtrees.map(s => Buffer.from(s))
  const zeros = treeData.zeros.map(z => bytes32ToBigInt(Buffer.from(z)))

  const { pathElements, pathIndices } = await buildMerklePath(
    depositInfo.leafIndex, filledSubtrees, zeros
  )

  const nullifier = await poseidonHash([idSecret, BigInt(depositInfo.depositIndex)])
  const nullifierHashBuf = bigIntToBytes32BE(nullifier)
  const recipientField = bytes32ToBigInt(Buffer.from(recipient.toBytes()))

  const input = {
    idSecret: idSecret.toString(),
    depositIndex: depositInfo.depositIndex.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
    root: bytes32ToBigInt(root).toString(),
    nullifierHash: nullifier.toString(),
    recipient: recipientField.toString(),
  }

  const snarkjs = await import('snarkjs')
  const { proof } = await snarkjs.groth16.fullProve(input, WITHDRAW_WASM, WITHDRAW_ZKEY)
  const packedProof = packProof(proof)

  return await program.methods
    .withdraw(
      packedProof,
      toBytes32(root),
      toBytes32(nullifierHashBuf),
      recipient,
      denominationBN,
    )
    .accounts({ payer: payer.publicKey, recipient })
    .instruction()
}
