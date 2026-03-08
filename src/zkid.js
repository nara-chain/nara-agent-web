/**
 * ZK ID module — browser wrapper around nara-sdk/src/zkid.
 * - ZKID_DENOMINATIONS as array format for UI
 * - deposit() wrapper converting BigInt denomination to BN
 * - withdraw() wrapper delegating to SDK's makeWithdrawIx
 */
import BN from 'bn.js'
import {
  deriveIdSecret,
  isValidRecipient,
  generateValidRecipient,
  getZkIdInfo,
  getConfig as getZkIdConfig,
  createZkId,
  deposit as sdkDeposit,
  scanClaimableDeposits,
  makeWithdrawIx,
} from 'nara-sdk/src/zkid'

export { deriveIdSecret, isValidRecipient, generateValidRecipient, getZkIdInfo, getZkIdConfig, createZkId, scanClaimableDeposits }

export const ZKID_DENOMINATIONS = [
  { label: '1', value: 1_000_000_000n },
  { label: '10', value: 10_000_000_000n },
  { label: '100', value: 100_000_000_000n },
  { label: '1,000', value: 1_000_000_000_000n },
  { label: '10,000', value: 10_000_000_000_000n },
  { label: '100,000', value: 100_000_000_000_000n },
]

/** Deposit — wraps SDK, converts BigInt denomination to BN */
export async function deposit(connection, payer, name, denomination) {
  return sdkDeposit(connection, payer, name, new BN(denomination.toString()))
}

/** Withdraw — returns instruction via SDK's makeWithdrawIx, passing browser ZK file URLs */
export async function withdraw(connection, payer, name, idSecret, depositInfo, recipient) {
  return makeWithdrawIx(connection, payer.publicKey, name, idSecret, depositInfo, recipient, {
    withdrawWasm: '/zk/withdraw.wasm',
    withdrawZkey: '/zk/withdraw_final.zkey',
  })
}
