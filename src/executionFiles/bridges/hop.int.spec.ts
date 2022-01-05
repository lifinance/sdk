import { ethers } from 'ethers'
import { getRpcProvider } from '../../connectors'
import { ChainId, ParsedReceipt } from '../../types'
import hop from './hop'

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
  const parsed = await hop.parseReceipt(toAddress, toTokenAddress, tx, receipt)
  const needed = {
    toAmount: parsed.toAmount,
    gasUsed: parsed.gasUsed,
    gasPrice: parsed.gasPrice,
    gasFee: parsed.gasFee,
    toTokenAddress: parsed.toTokenAddress,
  }

  expect(needed).toEqual(expected)
}

describe('hop', () => {
  describe('parse receipt', () => {
    describe('to ARB', () => {
      it('to native', async () => {
        // from: https://polygonscan.com/tx/0xdeb2603a3028916362a9bb130b4a2b7932843854db8a0cb1c72a646d44e33835
        // to: https://arbiscan.io/tx/0x92753b6ffcaff07d33a6edf5ed25697f87c4ceef79a6418bd6cc19397589b958
        const hash =
          '0x92753b6ffcaff07d33a6edf5ed25697f87c4ceef79a6418bd6cc19397589b958'
        const toAddress = '0x353285385ed77d1e90d3788c74bdfa2534c11ebd'
        const toTokenAddress = ethers.constants.AddressZero
        const expected = {
          toAmount: '171136016263698111',
          toTokenAddress,
          gasUsed: '1287429',
          gasPrice: '1523898958',
          gasFee: '1961911711598982',
        }

        await getAndTestTransaction(
          hash,
          ChainId.ARB,
          toAddress,
          toTokenAddress,
          expected
        )
      })

      it('to token', async () => {
        // from: https://polygonscan.com/tx/0x925e62f0b5eb8b5498e3f19103d2b4f03d96160bbc6429c254015581970aae53
        // to: https://arbiscan.io/tx/0xc733205319dd3bbcbeb58ad3aa64ce1ed3afa0c1b1c8a6773b1a7d1831248c66
        const hash =
          '0xc733205319dd3bbcbeb58ad3aa64ce1ed3afa0c1b1c8a6773b1a7d1831248c66'
        const toAddress = '0xba966690326f93bb2353afb327afba021605209a'
        const toTokenAddress = '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1'
        const expected = {
          toAmount: '4447904046911778062136',
          toTokenAddress,
          gasUsed: '1486679',
          gasPrice: '1523898958',
          gasFee: '2265548578980482',
        }

        await getAndTestTransaction(
          hash,
          ChainId.ARB,
          toAddress,
          toTokenAddress,
          expected
        )
      })
    })

    describe('to DAI', () => {
      it('to native', async () => {
        // from: https://polygonscan.com/tx/0xd8bb041298dc516109d69d0ab7b9e05d67324299dc239b427b4d6f60581c71d4
        // to: https://blockscout.com/xdai/mainnet/tx/0xcb9b83b5b06b69c3d461c2d5511369fc39862ba1c0f406554c2fea31b24ca04d
        const hash =
          '0xcb9b83b5b06b69c3d461c2d5511369fc39862ba1c0f406554c2fea31b24ca04d'
        const toAddress = '0x4f43c9f389ff44ebf7f3363c76250aa2ff43feb3'
        const toTokenAddress = ethers.constants.AddressZero
        const expected = {
          toAmount: '199502386217315303857',
          toTokenAddress,
          gasUsed: '288258',
          gasPrice: '3969000000',
          gasFee: '1144096002000000',
        }

        await getAndTestTransaction(
          hash,
          ChainId.DAI,
          toAddress,
          toTokenAddress,
          expected
        )
      })

      it('to token', async () => {
        // from: https://optimistic.etherscan.io/tx/0x9659330c0d02045a4faed57bdcae67d9bc48e7b5c4ab0b88b1183daca6faaa90
        // to: https://blockscout.com/xdai/mainnet/tx/0xe4eb23f1e6d985faaa305b8c528b8c1c00c3be42142395f0dfcda2964e506572
        const hash =
          '0xe4eb23f1e6d985faaa305b8c528b8c1c00c3be42142395f0dfcda2964e506572'
        const toAddress = '0xbeeb1597f83ab314d7f74d11670aaaacc53d822c'
        const toTokenAddress = '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83'
        const expected = {
          toAmount: '36261142',
          toTokenAddress,
          gasUsed: '305776',
          gasPrice: '90000000000',
          gasFee: '27519840000000000',
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
  })
})
