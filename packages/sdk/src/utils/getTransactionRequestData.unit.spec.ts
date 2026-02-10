import { describe, expect, it, vi } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import { getTransactionRequestData } from './getTransactionRequestData.js'

describe('getTransactionRequestData', () => {
  it('returns step.transactionRequest.data when no hook', async () => {
    const data = '0xdeadbeef'
    const step = { transactionRequest: { data } } as any

    expect(await getTransactionRequestData(step)).toBe(data)
  })

  it('throws TransactionUnprepared when step has no transactionRequest or data', async () => {
    await expect(getTransactionRequestData({} as any)).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionUnprepared,
      message: 'Unable to prepare transaction.',
    })
  })

  it('calls updateTransactionRequestHook when provided and returns its data', async () => {
    const originalData = '0xoriginal'
    const customizedData = '0xcustomized'
    const step = { transactionRequest: { data: originalData } } as any
    const updateTransactionRequestHook = vi.fn().mockResolvedValue({
      data: customizedData,
    })

    const result = await getTransactionRequestData(step, {
      updateTransactionRequestHook,
    })

    expect(updateTransactionRequestHook).toHaveBeenCalledWith({
      requestType: 'transaction',
      data: originalData,
    })
    expect(result).toBe(customizedData)
  })

  it('throws TransactionUnprepared when hook leaves data empty or undefined', async () => {
    const step = { transactionRequest: { data: '0xabc' } } as any
    const updateTransactionRequestHook = vi.fn().mockResolvedValue({ data: '' })

    await expect(
      getTransactionRequestData(step, { updateTransactionRequestHook })
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionUnprepared,
      message: 'Unable to prepare transaction.',
    })
  })
})
