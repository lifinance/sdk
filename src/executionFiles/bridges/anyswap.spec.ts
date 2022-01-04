import { getRpcProvider } from '../../connectors'
import { ParsedReceipt, ChainId } from '../../types'
import anyswap from './anyswap'

jest.setTimeout(10_000)

async function getAndTestTransaction(
  hash: string,
  chainId: ChainId,
  toAddress: string,
  toTokenAddress: string,
  expected: ParsedReceipt
) {
  const provider = getRpcProvider(chainId)
  const tx = await provider.getTransaction(hash)
  const receipt = await tx.wait()
  const parsed = anyswap.parseReceipt(toAddress, toTokenAddress, tx, receipt)
  expect(parsed).toEqual(expected)
}

describe('anyswap', () => {
  describe('parse receipt', () => {
    describe('to POL', () => {
      it('to token', async () => {
        // https://polygonscan.com/tx/0x3a2cd673f9df59ac714a4e7dc2cfc5cfaee82c3d8a3a5af34efb71637fe73474
        const hash =
          '0x3a2cd673f9df59ac714a4e7dc2cfc5cfaee82c3d8a3a5af34efb71637fe73474'
        const toAddress = '0x3719305d05682a05dbc7cc83892060eb36758f5e'
        const toTokenAddress = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
        const expected = {
          fromAmount: '0',
          toAmount: '63692000',
          toTokenAddress,
          gasUsed: '99580',
          gasPrice: '550000000000',
          gasFee: '54769000000000000',
        }

        await getAndTestTransaction(
          hash,
          ChainId.POL,
          toAddress,
          toTokenAddress,
          expected
        )
      })
    })
  })
})
