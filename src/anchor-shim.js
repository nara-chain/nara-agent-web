export * from '../node_modules/@coral-xyz/anchor/dist/browser/index.js'

export class Wallet {
  constructor(payer) {
    this.payer = payer
    this.publicKey = payer.publicKey
  }
  async signTransaction(tx) { tx.partialSign(this.payer); return tx }
  async signAllTransactions(txs) { txs.forEach(tx => tx.partialSign(this.payer)); return txs }
}
