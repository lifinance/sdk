/**
 * The wallet reported a single-call EIP-5792 bundle and then had no record
 * of it: it dropped the bundle before it sent it, so it can never land.
 * `waitForBatchTransactionReceipt` throws it; the batched wait task clears
 * the action.
 */
export class CallBundleDroppedError extends Error {
  constructor(cause: Error) {
    super('The wallet dropped the call bundle before it sent it.', { cause })
    this.name = 'CallBundleDroppedError'
  }
}
