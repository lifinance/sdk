import {
  approveToken,
  bulkGetTokenApproval,
  getTokenApproval,
  revokeTokenApproval,
} from '../src/allowance'
import { constants, providers, Signer, Wallet } from 'ethers'
import { ChainId, CoinKey, findDefaultToken, Token } from '@lifinance/types'
import BigNumber from 'bignumber.js'
import { sleep } from '../src/utils/utils'
import { getApproved, setApproval } from '../src/allowance/utils'

const USDC_ON_DAI = findDefaultToken(CoinKey.USDC, ChainId.DAI)
const USDT_ON_DAI = findDefaultToken(CoinKey.USDT, ChainId.DAI)
const SUSHISWAP_APPROVAL_ADDRESS_ON_DAI =
  '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'

describe('allowance e2e tests', () => {
  let signer: Signer

  const checkSetApproval = async (
    tokenAddress: string,
    expectedAmount: string
  ) => {
    const approvedAmount = await getApproved(
      signer,
      tokenAddress,
      SUSHISWAP_APPROVAL_ADDRESS_ON_DAI
    )

    expect(new BigNumber(expectedAmount).eq(approvedAmount)).toBeTruthy()
  }

  const revokeApproval = async (token: Token): Promise<void> => {
    const tx = await setApproval(
      signer,
      token.address,
      SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
      '0'
    )
    await tx.wait()
    await sleep(2000)
  }

  beforeAll(async () => {
    // add your MNEMONIC to the environment to be able to run the tests
    expect(process.env.MNEMONIC).toBeDefined()

    const provider = new providers.JsonRpcProvider(
      'https://rpc.gnosischain.com/',
      100
    )
    const mnemonic = process.env.MNEMONIC || ''
    signer = Wallet.fromMnemonic(mnemonic).connect(provider)
  })

  describe('approveToken', () => {
    beforeEach(async () => {
      // revoke approval to get a clean start
      console.log('revoking old approvals')
      await revokeApproval(USDC_ON_DAI)
    })

    it('it should approve the requested amount', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken({
        signer,
        token: USDC_ON_DAI,
        approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
        amount,
        infiniteApproval: false
    })

      await checkSetApproval(USDC_ON_DAI.address, amount)
    })

    it('it should set infinite approval', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken({
        signer,
        token: USDC_ON_DAI,
        approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
        amount,
        infiniteApproval: true
    })

      await checkSetApproval(
        USDC_ON_DAI.address,
        constants.MaxUint256.toString()
      )
    })
  })

  describe('revokeTokenApproval', () => {
    it('it should revoke the previously approved amount', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken({
        signer,
        token: USDC_ON_DAI,
        approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
        amount,
        infiniteApproval: false
    })

      await sleep(2000)

      await checkSetApproval(USDC_ON_DAI.address, amount)

      console.log('revoking approval')

      await revokeTokenApproval({
        signer,
        token: USDC_ON_DAI,
        approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI
      })

      await sleep(2000)

      await checkSetApproval(USDC_ON_DAI.address, '0')
    })
  })

  describe('getTokenApproval', () => {
    it('it should return the approved amount', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken({
        signer,
        token: USDC_ON_DAI,
        approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
        amount,
        infiniteApproval: false
      })

      await sleep(2000)

      console.log('fetching current approval')

      const result = await getTokenApproval(
        signer,
        USDC_ON_DAI,
        SUSHISWAP_APPROVAL_ADDRESS_ON_DAI
      )
      expect(result).toEqual(amount)
    })
  })

  describe('bulkGetTokenApproval', () => {
    beforeEach(async () => {
      console.log('revoking old approvals')
      await revokeApproval(USDC_ON_DAI)
      await revokeApproval(USDT_ON_DAI)
    })

    it('it should return the approved amount', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken({
        signer,
        token: USDT_ON_DAI,
        approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
        amount,
        infiniteApproval: false
      })

      await sleep(2000)

      console.log('fetching current approval')

      const result = await bulkGetTokenApproval(signer, [
        {
          token: USDC_ON_DAI,
          approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
        },
        {
          token: USDT_ON_DAI,
          approvalAddress: SUSHISWAP_APPROVAL_ADDRESS_ON_DAI,
        },
      ])

      expect(result[0].approval).toEqual('0')
      expect(result[1].approval).toEqual(amount)
    })
  })
})
