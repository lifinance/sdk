import { getRpcProvider } from '../../connectors'
import { ParsedReceipt, ChainId } from '../../types'
import { uniswap } from './uniswaps'

async function getAndTestTransaction(
  hash: string,
  chainId: ChainId,
  expected: ParsedReceipt
) {
  const provider = getRpcProvider(chainId)
  const tx = await provider.getTransaction(hash)
  const receipt = await tx.wait()
  const parsed = await uniswap.parseReceipt(tx, receipt)
  const needed = {
    fromAmount: parsed.fromAmount,
    toAmount: parsed.toAmount,
    gasUsed: parsed.gasUsed,
    gasPrice: parsed.gasPrice,
    gasFee: parsed.gasFee,
  }

  expect(needed).toEqual(expected)
}

describe('uniswaps', () => {
  describe('parse receipt', () => {
    describe('FTM', () => {
      // contract: https://ftmscan.com/address/0xF491e7B69E4244ad4002BC14e878a34207E38c29 // SpookySwap

      it('gas to token', async () => {
        // https://ftmscan.com/tx/0xad8f0fdde06ca8e8b3b2bf533e718e828f2ef3735ea5813dc0828cb5926e7aaa
        const hash =
          '0xad8f0fdde06ca8e8b3b2bf533e718e828f2ef3735ea5813dc0828cb5926e7aaa'
        const expected = {
          fromAmount: '18000000000000000000',
          toAmount: '42329395',
          gasUsed: '123120',
          gasPrice: '133223800000',
          gasFee: '16402514256000000',
        }

        await getAndTestTransaction(hash, ChainId.FTM, expected)
      })

      it('token to gas', async () => {
        // https://ftmscan.com/tx/0x6aea4a85b27f56d065c6ec7f35a2ba3eade1ffc81edec5678ff5379dfe5ae095
        const hash =
          '0x6aea4a85b27f56d065c6ec7f35a2ba3eade1ffc81edec5678ff5379dfe5ae095'
        const expected = {
          fromAmount: '12859971558665000000',
          toAmount: '4835566562417085335',
          gasUsed: '126060',
          gasPrice: '129940900000',
          gasFee: '16380349854000000',
        }

        await getAndTestTransaction(hash, ChainId.FTM, expected)
      })

      it('token to token', async () => {
        // https://ftmscan.com/tx/0xff6dfe70cd844d5f810b8f25ce9ffdd1eb657481d151a7a31583c1800dab8acc
        const hash =
          '0xff6dfe70cd844d5f810b8f25ce9ffdd1eb657481d151a7a31583c1800dab8acc'
        const expected = {
          fromAmount: '2340444444444444444444',
          toAmount: '31182408',
          gasUsed: '240833',
          gasPrice: '129208000000',
          gasFee: '31117550264000000',
        }

        await getAndTestTransaction(hash, ChainId.FTM, expected)
      })
    })

    describe('AVA', () => {
      // contract: https://snowtrace.io/address/0x1b02da8cb0d097eb8d57a175b88c7d8b47997506 // SushiSwap

      it('gas to token', async () => {
        // https://snowtrace.io/tx/0x1d423f9ef5d29aa0097346be689745c8eab868507570852e6e5b359e2a2a5652
        const hash =
          '0x1d423f9ef5d29aa0097346be689745c8eab868507570852e6e5b359e2a2a5652'
        const expected = {
          fromAmount: '10500000000000000000',
          toAmount: '101218993217470388875',
          gasUsed: '143522',
          gasPrice: '25000000000',
          gasFee: '3588050000000000',
        }

        await getAndTestTransaction(hash, ChainId.AVA, expected)
      })

      it('token to gas', async () => {
        // https://snowtrace.io/tx/0x4aef5833612c3efac1ebe3b63236ae5a1a4cfe577c4153e6a8f3d6c64142ce6b
        const hash =
          '0x4aef5833612c3efac1ebe3b63236ae5a1a4cfe577c4153e6a8f3d6c64142ce6b'
        const expected = {
          fromAmount: '49990000000000000000',
          toAmount: '456716699144364776',
          gasUsed: '136524',
          gasPrice: '25000000000',
          gasFee: '3413100000000000',
        }

        await getAndTestTransaction(hash, ChainId.AVA, expected)
      })

      it('token to token', async () => {
        // https://snowtrace.io/tx/0x0fdac209b10c1c79c7bb1ca595aca40039df4cf4520d7d889fe386c540cb5732
        const hash =
          '0x0fdac209b10c1c79c7bb1ca595aca40039df4cf4520d7d889fe386c540cb5732'
        const expected = {
          fromAmount: '62368817310597076466',
          toAmount: '6550192385894452619',
          gasUsed: '179586',
          gasPrice: '25000000000',
          gasFee: '4489650000000000',
        }

        await getAndTestTransaction(hash, ChainId.AVA, expected)
      })
    })
  })
})
