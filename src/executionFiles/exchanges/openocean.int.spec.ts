import { getRpcProvider } from '../../connectors'
import { ParsedReceipt, ChainId } from '../../types'
import { openocean } from './openocean'

jest.setTimeout(20000)

async function getAndTestTransaction(
  hash: string,
  chainId: ChainId,
  expected: ParsedReceipt
) {
  const provider = getRpcProvider(chainId)
  const tx = await provider.getTransaction(hash)
  const receipt = await tx.wait()
  const parsed = await openocean.parseReceipt(tx, receipt)
  const needed = {
    fromAmount: parsed.fromAmount,
    toAmount: parsed.toAmount,
    gasUsed: parsed.gasUsed,
    gasPrice: parsed.gasPrice,
    gasFee: parsed.gasFee,
  }

  expect(needed).toEqual(expected)
}

describe('openocean', () => {
  describe('parse receipt', () => {
    describe('ETH', () => {
      // contract: https://etherscan.io/address/0x6352a56caadC4F1E25CD6c75970Fa768A3304e64

      it('gas to token', async () => {
        // https://etherscan.io/tx/0x96221a0f16ea091509ffde86b4353421c71a3c63b6c970edc6aeb305c8de60a9
        const hash =
          '0x96221a0f16ea091509ffde86b4353421c71a3c63b6c970edc6aeb305c8de60a9'
        const expected = {
          fromAmount: '360000000000000000',
          toAmount: '9036424715107866161',
          gasUsed: '120197',
          gasPrice: '47473672539',
          gasFee: '5706193018170183',
        }

        await getAndTestTransaction(hash, ChainId.ETH, expected)
      })

      it('token to gas', async () => {
        // https://etherscan.io/tx/0xba4666042f04892c9d4ed3903d3540f313bb3c4bb41f9334ba6a8b482b637b3a
        const hash =
          '0xba4666042f04892c9d4ed3903d3540f313bb3c4bb41f9334ba6a8b482b637b3a'
        const expected = {
          fromAmount: '1500000000000000000000',
          toAmount: '89164829604216010',
          gasUsed: '113464',
          gasPrice: '61000000000',
          gasFee: '6921304000000000',
        }

        await getAndTestTransaction(hash, ChainId.ETH, expected)
      })

      it('token to token', async () => {
        // https://etherscan.io/tx/0x774599ddfa2078dfbcda87d0a73dbbdfc5cc3461a38ae22d76422777e7d0da65
        const hash =
          '0x774599ddfa2078dfbcda87d0a73dbbdfc5cc3461a38ae22d76422777e7d0da65'
        const expected = {
          fromAmount: '1058238789484467856963',
          toAmount: '2416489543',
          gasUsed: '182062',
          gasPrice: '145000000000',
          gasFee: '26398990000000000',
        }

        await getAndTestTransaction(hash, ChainId.ETH, expected)
      })
    })

    describe('FTM', () => {
      // contract: https://ftmscan.com/address/0x6352a56caadc4f1e25cd6c75970fa768a3304e64

      it('gas to token', async () => {
        // https://ftmscan.com/tx/0xbf6f48ebcc1cb9c67504c06eb5141e09cbb8108c765a7a972303de079fed9501
        const hash =
          '0xbf6f48ebcc1cb9c67504c06eb5141e09cbb8108c765a7a972303de079fed9501'
        const expected = {
          fromAmount: '182000000000000000000',
          toAmount: '25235574952633087',
          gasUsed: '185876',
          gasPrice: '206829700000',
          gasFee: '38444677317200000',
        }

        await getAndTestTransaction(hash, ChainId.FTM, expected)
      })

      it('token to gas', async () => {
        // https://ftmscan.com/tx/0x2c7d6b05f16a60a4bdbe1e98603512689a9a4023cddc4ccfaa7e7180a1e91cfa
        const hash =
          '0x2c7d6b05f16a60a4bdbe1e98603512689a9a4023cddc4ccfaa7e7180a1e91cfa'
        const expected = {
          fromAmount: '105400394000000000000',
          toAmount: '1105238869098956261535',
          gasUsed: '194944',
          gasPrice: '309968500000',
          gasFee: '60426499264000000',
        }

        await getAndTestTransaction(hash, ChainId.FTM, expected)
      })

      it('token to token', async () => {
        // https://ftmscan.com/tx/0x726e3b046419846950f67005f8221b674b2c16df075f7c88c542670f9028731c
        const hash =
          '0x726e3b046419846950f67005f8221b674b2c16df075f7c88c542670f9028731c'
        const expected = {
          fromAmount: '999062184183748000',
          toAmount: '998485',
          gasUsed: '252586',
          gasPrice: '230000000000',
          gasFee: '58094780000000000',
        }

        await getAndTestTransaction(hash, ChainId.FTM, expected)
      })
    })
  })
})
