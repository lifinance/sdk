import { getRpcProvider } from '../../connectors'
import { ParsedReceipt, ChainId } from '../../types'
import { oneinch } from './oneinch'

async function getAndTestTransaction(
  hash: string,
  chainId: ChainId,
  expected: ParsedReceipt
) {
  const provider = getRpcProvider(chainId)
  const tx = await provider.getTransaction(hash)
  const receipt = await tx.wait()
  const parsed = await oneinch.parseReceipt(tx, receipt)
  const needed = {
    fromAmount: parsed.fromAmount,
    toAmount: parsed.toAmount,
    gasUsed: parsed.gasUsed,
    gasPrice: parsed.gasPrice,
    gasFee: parsed.gasFee,
  }

  expect(needed).toEqual(expected)
}

describe('oneinch', () => {
  describe('parse receipt', () => {
    describe('POL', () => {
      it('gas to token', async () => {
        // https://polygonscan.com/tx/0x88189edfbfaf47a1c8ae0b22680ff8385380cbdf7d8cf4e35f6c0337e5d23396
        const hash =
          '0x88189edfbfaf47a1c8ae0b22680ff8385380cbdf7d8cf4e35f6c0337e5d23396'
        const expected = {
          fromAmount: '72171968998379871006',
          toAmount: '188144996',
          gasUsed: '209867',
          gasPrice: '100000000000',
          gasFee: '20986700000000000',
        }

        await getAndTestTransaction(hash, ChainId.POL, expected)
      })

      it('token to gas', async () => {
        // https://polygonscan.com/tx/0x487aabcdbb3a0334328e300988e5f0a4c86e0091da33136f99f71616c090ed72
        const hash =
          '0x487aabcdbb3a0334328e300988e5f0a4c86e0091da33136f99f71616c090ed72'
        const expected = {
          fromAmount: '3500000000',
          toAmount: '1336927115383615274253',
          gasUsed: '333892',
          gasPrice: '82526697893',
          gasFee: '27555004212889556',
        }

        await getAndTestTransaction(hash, ChainId.POL, expected)
      })

      it('token to token', async () => {
        // https://polygonscan.com/tx/0x129980866efb775cdeeb2b5f5bf65adc04d65ffc0b8caa54902bf856dac1b1da
        const hash =
          '0x129980866efb775cdeeb2b5f5bf65adc04d65ffc0b8caa54902bf856dac1b1da'
        const expected = {
          fromAmount: '500000000',
          toAmount: '24182623324834183458',
          gasUsed: '172751',
          gasPrice: '100000000000',
          gasFee: '17275100000000000',
        }

        await getAndTestTransaction(hash, ChainId.POL, expected)
      })
    })
  })
})
