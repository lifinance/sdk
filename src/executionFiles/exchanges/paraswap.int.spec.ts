import { getRpcProvider } from '../../connectors'
import { ParsedReceipt, ChainId } from '../../types'
import { paraswap } from './paraswap'

jest.setTimeout(20000)

async function getAndTestTransaction(
  hash: string,
  chainId: ChainId,
  expected: ParsedReceipt
) {
  const provider = getRpcProvider(chainId)
  const tx = await provider.getTransaction(hash)
  const receipt = await tx.wait()
  const parsed = await paraswap.parseReceipt(tx, receipt)
  const needed = {
    fromAmount: parsed.fromAmount,
    toAmount: parsed.toAmount,
    gasUsed: parsed.gasUsed,
    gasPrice: parsed.gasPrice,
    gasFee: parsed.gasFee,
  }

  expect(needed).toEqual(expected)
}

describe('paraswap', () => {
  describe('parse receipt', () => {
    describe('POL', () => {
      // contract: https://polygonscan.com/address/0xdef171fe48cf0115b1d80b88dc8eab59176fee57

      it('gas to token', async () => {
        // https://polygonscan.com/tx/0xa33ed2144104ac3c738be8b38e3f0babdd33879818d04f0fe878ef1202dd33fd
        const hash =
          '0xa33ed2144104ac3c738be8b38e3f0babdd33879818d04f0fe878ef1202dd33fd'
        const expected = {
          fromAmount: '30000000000000000',
          toAmount: '20275346467312',
          gasUsed: '150209',
          gasPrice: '30000000000',
          gasFee: '4506270000000000',
        }

        await getAndTestTransaction(hash, ChainId.POL, expected)
      })

      it('token to gas', async () => {
        // https://polygonscan.com/tx/0x9d9833b93a2711ba85a3e66d15349f94e155ac3c2de35ac339852afeb0ed516a
        const hash =
          '0x9d9833b93a2711ba85a3e66d15349f94e155ac3c2de35ac339852afeb0ed516a'
        const expected = {
          fromAmount: '1000000',
          toAmount: '379834850304876809',
          gasUsed: '198247',
          gasPrice: '60000000000',
          gasFee: '11894820000000000',
        }

        await getAndTestTransaction(hash, ChainId.POL, expected)
      })

      it('token to token', async () => {
        // https://polygonscan.com/tx/0x284f956d45d87231e8ceb727b368815d420aa76d53d89d9c191a58360cd2b714
        const hash =
          '0x284f956d45d87231e8ceb727b368815d420aa76d53d89d9c191a58360cd2b714'
        const expected = {
          fromAmount: '670315347',
          toAmount: '670251200',
          gasUsed: '433018',
          gasPrice: '40000000000',
          gasFee: '17320720000000000',
        }

        await getAndTestTransaction(hash, ChainId.POL, expected)
      })
    })

    describe('ETH', () => {
      it('gas to token', async () => {
        // https://etherscan.io/tx/0xb9278a5dc747daa3a9d9abaaad99dc78edee4336bcde1a55803b33e78f1d9b0a
        const hash =
          '0xb9278a5dc747daa3a9d9abaaad99dc78edee4336bcde1a55803b33e78f1d9b0a'
        const expected = {
          fromAmount: '1000000000000000000',
          toAmount: '339533322724581681633',
          gasUsed: '122273',
          gasPrice: '109354810891',
          gasFee: '13371140792075243',
        }

        await getAndTestTransaction(hash, ChainId.ETH, expected)
      })

      it('token to gas', async () => {
        // https://etherscan.io/tx/0xf5d8f643ca8015a325e6a48de974d819746ba22a3e162067478f2f9844327584
        const hash =
          '0xf5d8f643ca8015a325e6a48de974d819746ba22a3e162067478f2f9844327584'
        const expected = {
          fromAmount: '2408148646617858888899',
          toAmount: '1912209818105502603',
          gasUsed: '204987',
          gasPrice: '65485269978',
          gasFee: '13423629036980286',
        }

        await getAndTestTransaction(hash, ChainId.ETH, expected)
      })

      it('token to token', async () => {
        // https://etherscan.io/tx/0x7defc4001686be2c3566aae8a571a9aa2ccb2a3b0196e9a3cd4e848a7b7360a8
        const hash =
          '0x7defc4001686be2c3566aae8a571a9aa2ccb2a3b0196e9a3cd4e848a7b7360a8'
        const expected = {
          fromAmount: '4738288143432099952674329',
          toAmount: '113824018328',
          gasUsed: '317356',
          gasPrice: '80437887812',
          gasFee: '25527446324465072',
        }

        await getAndTestTransaction(hash, ChainId.ETH, expected)
      })
    })

    describe('BSC', () => {
      it('gas to token', async () => {
        // https://bscscan.com/tx/0x13e4cf8063739ba0c417e45a14c9828d0d4c7439b729b647460b92809cd2ea18
        const hash =
          '0x13e4cf8063739ba0c417e45a14c9828d0d4c7439b729b647460b92809cd2ea18'
        const expected = {
          fromAmount: '22039000000000000000',
          toAmount: '12088886792595598960314',
          gasUsed: '388803',
          gasPrice: '14000000000',
          gasFee: '5443242000000000',
        }

        await getAndTestTransaction(hash, ChainId.BSC, expected)
      })

      it('token to gas', async () => {
        // https://bscscan.com/tx/0x39ac7cae8a2904c4ce7884a8ee1e423d285bf398038651df2f02b13072878fff
        const hash =
          '0x39ac7cae8a2904c4ce7884a8ee1e423d285bf398038651df2f02b13072878fff'
        const expected = {
          fromAmount: '425000000000000000000',
          toAmount: '772188601101154310',
          gasUsed: '180952',
          gasPrice: '5000000000',
          gasFee: '904760000000000',
        }

        await getAndTestTransaction(hash, ChainId.BSC, expected)
      })

      it('token to token', async () => {
        // https://bscscan.com/tx/0x5d9dc214f92962b410f82d39a3010aa82e265161504f41875d6826051d23e8ac
        const hash =
          '0x5d9dc214f92962b410f82d39a3010aa82e265161504f41875d6826051d23e8ac'
        const expected = {
          fromAmount: '11751444999999999442944',
          toAmount: '12106071221556024221490',
          gasUsed: '654718',
          gasPrice: '14000000000',
          gasFee: '9166052000000000',
        }

        await getAndTestTransaction(hash, ChainId.BSC, expected)
      })
    })

    describe('AVA', () => {
      it('gas to token', async () => {
        // https://snowtrace.io/tx/0x3f001dbf454233c9a7f8a4d51cf5f9471de58e6ce821479f7580e1b2d08bddba
        const hash =
          '0x3f001dbf454233c9a7f8a4d51cf5f9471de58e6ce821479f7580e1b2d08bddba'
        const expected = {
          fromAmount: '2012800000000000000000',
          toAmount: '227644054156',
          gasUsed: '2463323',
          gasPrice: '31640625000',
          gasFee: '77941079296875000',
        }

        await getAndTestTransaction(hash, ChainId.AVA, expected)
      })

      it('token to gas', async () => {
        // https://snowtrace.io/tx/0x885918beacec7b00f37af7ec8909ddfc32a5faf8f7f63ea02b0f8b0717197a19
        const hash =
          '0x885918beacec7b00f37af7ec8909ddfc32a5faf8f7f63ea02b0f8b0717197a19'
        const expected = {
          fromAmount: '1092937650000000000',
          toAmount: '9609034319672914',
          gasUsed: '230587',
          gasPrice: '25000000000',
          gasFee: '5764675000000000',
        }

        await getAndTestTransaction(hash, ChainId.AVA, expected)
      })

      it('token to token', async () => {
        // https://snowtrace.io/tx/0x8618498076427e7bbaf61d669296367f9f2f90d2798bcfeb6c0758c71cbdc392
        const hash =
          '0x8618498076427e7bbaf61d669296367f9f2f90d2798bcfeb6c0758c71cbdc392'
        const expected = {
          fromAmount: '498900000',
          toAmount: '905688930954956142',
          gasUsed: '285960',
          gasPrice: '25000000000',
          gasFee: '7149000000000000',
        }

        await getAndTestTransaction(hash, ChainId.AVA, expected)
      })
    })
  })
})
