import { ethers } from 'ethers'
import { getRpcProvider } from '../../connectors'
import { ParsedReceipt, ChainId } from '../../types'
import nxtp from './nxtp'

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
  const parsed = await nxtp.parseReceipt(toAddress, toTokenAddress, tx, receipt)
  const needed = {
    toAmount: parsed.toAmount,
    gasUsed: parsed.gasUsed,
    gasPrice: parsed.gasPrice,
    gasFee: parsed.gasFee,
    toTokenAddress: parsed.toTokenAddress,
  }

  expect(needed).toEqual(expected)
}

describe('nxtp', () => {
  describe('parse receipt', () => {
    describe('to POL', () => {
      it('to token', async () => {
        // https://polygonscan.com/tx/0x62192e1f4c4af229ff903d0990737c09f2e7151a3ac06146e07f91964a65f4e1
        const hash =
          '0x62192e1f4c4af229ff903d0990737c09f2e7151a3ac06146e07f91964a65f4e1'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = '0xc0b2983a17573660053beeed6fdb1053107cf387'
        const expected = {
          toAmount: '23354867418865622655',
          toTokenAddress,
          gasUsed: '327019',
          gasPrice: '36000000000',
          gasFee: '11772684000000000',
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

    describe('to DAI', () => {
      it('to token', async () => {
        // https://blockscout.com/xdai/mainnet/tx/0x133cb12a37b8e4777c5dd87b48b23b0908f3ce2b8549d0c75b2a036121c7e5e6
        const hash =
          '0x133cb12a37b8e4777c5dd87b48b23b0908f3ce2b8549d0c75b2a036121c7e5e6'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83'
        const expected = {
          toAmount: '477609',
          toTokenAddress,
          gasUsed: '88478',
          gasPrice: '5000000000',
          gasFee: '442390000000000',
        }

        await getAndTestTransaction(
          hash,
          ChainId.DAI,
          toAddress,
          toTokenAddress,
          expected
        )
      })

      it('to gas', async () => {
        // https://blockscout.com/xdai/mainnet/tx/0x7acbb96786981cc68c03b5945deaa15b09a8cd7b090d62d588b9e6b042fe9e45
        const hash =
          '0x7acbb96786981cc68c03b5945deaa15b09a8cd7b090d62d588b9e6b042fe9e45'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = ethers.constants.AddressZero
        const expected = {
          toAmount: '1108897500000000000',
          toTokenAddress,
          gasUsed: '79678',
          gasPrice: '24700002026',
          gasFee: '1968046761427628',
        }

        await getAndTestTransaction(
          hash,
          ChainId.DAI,
          toAddress,
          toTokenAddress,
          expected
        )
      })
    })

    describe('to FTM', () => {
      it('via LiFi-swap to token', async () => {
        // https://ftmscan.com/tx/0xfe1727142beb28224a762a1d970084493d9077e06aea3330908dc0fdb0314e3b
        const hash =
          '0xfe1727142beb28224a762a1d970084493d9077e06aea3330908dc0fdb0314e3b'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = '0x049d68029688eabf473097a2fc38ef61633a3c7a'
        const expected = {
          toAmount: '2109068',
          toTokenAddress,
          gasUsed: '432457',
          gasPrice: '189627240000',
          gasFee: '82005627328680000',
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

    describe('to AVA', () => {
      it('via LiFi-swap to token', async () => {
        // https://snowtrace.io/tx/0x96b63a58f42899e7f4407a3cca28f2b3d04d5eab527f405ef2982df9fb8a8826
        const hash =
          '0x96b63a58f42899e7f4407a3cca28f2b3d04d5eab527f405ef2982df9fb8a8826'
        const toAddress = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
        const toTokenAddress = '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664'
        const expected = {
          toAmount: '2106182',
          toTokenAddress,
          gasUsed: '418248',
          gasPrice: '27500000000',
          gasFee: '11501820000000000',
        }

        await getAndTestTransaction(
          hash,
          ChainId.AVA,
          toAddress,
          toTokenAddress,
          expected
        )
      })
    })
  })
})
