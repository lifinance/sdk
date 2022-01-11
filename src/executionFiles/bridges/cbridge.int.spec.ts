import { getRpcProvider } from '../../connectors'
import { ParsedReceipt, ChainId } from '../../types'
import cbridge from './cbridge'

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
  const parsed = await cbridge.parseReceipt(
    toAddress,
    toTokenAddress,
    tx,
    receipt
  )
  const needed = {
    toAmount: parsed.toAmount,
    gasUsed: parsed.gasUsed,
    gasPrice: parsed.gasPrice,
    gasFee: parsed.gasFee,
    toTokenAddress: parsed.toTokenAddress,
  }

  expect(needed).toEqual(expected)
}

describe('cBridge', () => {
  describe('parse receipt', () => {
    describe('to FTM', () => {
      it('to token', async () => {
        // https://ftmscan.com/tx/0x801b560be958b37607bd0ecbc24dffb1754289576316f5f2c8ef51db2b8d0e69
        const hash =
          '0x801b560be958b37607bd0ecbc24dffb1754289576316f5f2c8ef51db2b8d0e69'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = '0x04068da6c83afcfa0e13ba15a6696662335d5b75'
        const expected = {
          toAmount: '20115227',
          toTokenAddress,
          gasUsed: '130331',
          gasPrice: '575820800000',
          gasFee: '75047300684800000',
        }

        await getAndTestTransaction(
          hash,
          ChainId.FTM,
          toAddress,
          toTokenAddress,
          expected
        )
      })
    })

    describe('to POL', () => {
      it('to token', async () => {
        // https://polygonscan.com/tx/0x5bf745bb73e424fc528012046797bba244f4b3ac9575232e470adbb42deee7fe
        const hash =
          '0x5bf745bb73e424fc528012046797bba244f4b3ac9575232e470adbb42deee7fe'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
        const expected = {
          toAmount: '77709575',
          toTokenAddress,
          gasUsed: '142320',
          gasPrice: '40000000000',
          gasFee: '5692800000000000',
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

    describe('to BSC', () => {
      it('to token', async () => {
        // https://bscscan.com/tx/0x7479ba16a3175a726331bd4656b3e10ea4eccf1a4238b3b4ce3ee40a331e3aac
        const hash =
          '0x7479ba16a3175a726331bd4656b3e10ea4eccf1a4238b3b4ce3ee40a331e3aac'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'
        const expected = {
          toAmount: '18546871537774838494',
          toTokenAddress,
          gasUsed: '129129',
          gasPrice: '7000000000',
          gasFee: '903903000000000',
        }

        await getAndTestTransaction(
          hash,
          ChainId.BSC,
          toAddress,
          toTokenAddress,
          expected
        )
      })
    })

    describe('to ETH', () => {
      it('to token', async () => {
        // https://etherscan.io/tx/0x926eba7c5715119c3cb288c24387099436059173e3b1636b5fa6d924fbea1166
        const hash =
          '0x926eba7c5715119c3cb288c24387099436059173e3b1636b5fa6d924fbea1166'
        const toAddress = '0x806156cf758bf7e9cd4f06deff4f6ed01b8856d1'
        const toTokenAddress = '0x4fabb145d64652a948d72533023f6e7a623c7c53'
        const expected = {
          toAmount: '1016303097328024710006',
          toTokenAddress,
          gasUsed: '161836',
          gasPrice: '123073813828',
          gasFee: '19917773734668208',
        }

        await getAndTestTransaction(
          hash,
          ChainId.ETH,
          toAddress,
          toTokenAddress,
          expected
        )
      })

      it('to native', async () => {
        // https://etherscan.io/tx/0x6fcc44641ab24fd9af0557c20d4c9de0850072d61c56c934777f3eb0b7946008
        const hash =
          '0x6fcc44641ab24fd9af0557c20d4c9de0850072d61c56c934777f3eb0b7946008'
        const toAddress = '0x917a7277903148cDA75C4e761ed7f483470eA28C'
        const toTokenAddress = '0x0000000000000000000000000000000000000000'
        const expected = {
          toAmount: '260971291155827241',
          toTokenAddress,
          gasUsed: '139512',
          gasPrice: '162561423603',
          gasFee: '22679269329701736',
        }

        await getAndTestTransaction(
          hash,
          ChainId.ETH,
          toAddress,
          toTokenAddress,
          expected
        )
      })
    })
  })
})
