import { describe, expect, it, vi } from 'vitest'
import { getTransactionFailedMessage } from './getTransactionMessage.js'

describe('getTransactionFailedMessage', () => {
  const mockClient = {
    getChainById: vi.fn().mockResolvedValue({
      id: 1,
      name: 'Ethereum',
    }),
  } as any

  const mockStep = {
    action: {
      toChainId: 1,
      toToken: { symbol: 'USDC' },
    },
  } as any

  it('should return message without tx link', async () => {
    const message = await getTransactionFailedMessage(mockClient, mockStep)

    expect(message).toContain('Ethereum')
    expect(message).toContain('USDC')
    expect(message).not.toContain('block explorer')
  })

  it('should return message with tx link', async () => {
    const txLink = 'https://etherscan.io/tx/0x123'
    const message = await getTransactionFailedMessage(
      mockClient,
      mockStep,
      txLink
    )

    expect(message).toContain('block explorer')
    expect(message).toContain(txLink)
  })
})
