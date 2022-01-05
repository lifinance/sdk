import { ethers } from 'ethers'
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
  const parsed = await anyswap.parseReceipt(
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

    describe('to BSC', () => {
      it('to native', async () => {
        // https://anyswap.net/explorer/tx?params=0x63b5ef099ffed2c0c23a64dbab8695c2fcdc0f9e65efd2d1fa377904f9827f24
        // https://bscscan.com/tx/0xf14fe48cdc101d7a79f3379fbb63fdf880f750b0952d1ae8beeb607e36474415
        const hash =
          '0xf14fe48cdc101d7a79f3379fbb63fdf880f750b0952d1ae8beeb607e36474415'
        const toAddress = '0x42f59c0db03e143437bfd4c13a9e326b3f5d834e'
        const toTokenAddress = ethers.constants.AddressZero
        const expected = {
          toAmount: '1408268384922041257',
          toTokenAddress,
          gasUsed: '22168',
          gasPrice: '5500000000',
          gasFee: '121924000000000',
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
  })
})
