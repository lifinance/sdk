import type {
  FeeCost,
  GasCost,
  LiFiStep,
  LiFiStepExtended,
  TypedData,
} from '@lifi/sdk'
import {
  buildPermitTypedData,
  buildPermitWitnessTypedData,
  buildStep,
  buildTypedData,
  CANONICAL_PERMIT2,
  CHAIN_ID,
  FROM_ADDRESS,
  FROM_TOKEN,
  NATIVE_TOKEN,
} from './harness.mock.js'

/**
 * Fixtures of the new gasless flow, shaped after live `/v1/advanced/routes`
 * (`options.gasless: true`) and `/v1/advanced/stepTransaction` responses.
 *
 * At routes time a gasless step looks like a standard one: no typed data,
 * `executionType: 'transaction'`, the diamond as `approvalAddress` and a
 * non-zero gas cost (the relayer's gas). Only the relay fee marks it.
 */

const feeCost = (name: string, amount: string): FeeCost =>
  ({
    name,
    description: name,
    token: FROM_TOKEN,
    amount,
    amountUSD: '0.08',
    percentage: '0.05',
    included: true,
  }) as FeeCost

/** The relayer's gas, in the native token, as the backend prices it. */
export const GASLESS_GAS_COST: GasCost = {
  type: 'SEND',
  price: '30000000000',
  estimate: '2385806',
  limit: '2385806',
  amount: '71574180000000000',
  amountUSD: '0.0808',
  token: NATIVE_TOKEN,
} as GasCost

export const buildGaslessRouteStep = (
  options: { toChainId?: number } = {}
): LiFiStepExtended => {
  const step = buildStep({
    executionType: 'transaction',
    gasCosts: [GASLESS_GAS_COST],
    toChainId: options.toChainId,
  })
  step.estimate.feeCosts = [
    feeCost('LIFI Gasless Relay Fee', '86200'),
    feeCost('LIFI Fixed Fee', '125300'),
  ]
  step.typedData = []
  return step
}

/** Seconds, like the backend's `expiresAt`. */
const expiresAt = (): number => Math.floor(Date.now() / 1000) + 300

/**
 * The permit2 strategy (an EOA that is not delegated): an EIP-2612 `Permit` to
 * canonical Permit2 plus the `PermitWitnessTransferFrom` the relayer submits.
 * No `transactionRequest`: the step only executes through the relay.
 */
export const answerWithPermit2Gasless = (step: LiFiStep): LiFiStep => {
  const { typedData: _typedData, transactionRequest: _tx, ...rest } = step
  return {
    ...rest,
    typedData: [
      buildPermitTypedData(CANONICAL_PERMIT2),
      buildPermitWitnessTypedData(),
    ],
    expiresAt: expiresAt(),
  } as LiFiStep
}

export const buildSignedBatchedCallTypedData = (): TypedData =>
  buildTypedData({
    primaryType: 'SignedBatchedCall',
    domain: {
      name: 'Calibur',
      version: '1.0.0',
      chainId: CHAIN_ID,
      // Under EIP-7702 the account that executes the batch is the user's own.
      verifyingContract: FROM_ADDRESS,
      salt: `0x${'00'.repeat(31)}01`,
    },
    message: {
      batchedCall: { calls: [], revertOnFailure: true },
      nonce: '7',
      keyHash: `0x${'00'.repeat(32)}`,
      executor: `0x${'ee'.repeat(20)}`,
      deadline: String(expiresAt()),
    },
  })

/** The calibur strategy (an EOA delegated to Calibur): one `SignedBatchedCall`. */
export const answerWithCaliburGasless = (step: LiFiStep): LiFiStep => {
  const { typedData: _typedData, transactionRequest: _tx, ...rest } = step
  return {
    ...rest,
    typedData: [buildSignedBatchedCallTypedData()],
    expiresAt: expiresAt(),
  } as LiFiStep
}
