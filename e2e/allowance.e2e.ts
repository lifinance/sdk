import { approveToken, revokeTokenApproval } from '../src/allowance'
import { constants, providers, Signer, Wallet } from 'ethers'
import { ChainId, CoinKey, findDefaultToken } from '@lifinance/types'
import BigNumber from 'bignumber.js'
import { sleep } from '../src/utils/utils'
import { getApproved, setApproval } from '../src/allowance/utils'

const USDC_ON_DAI = findDefaultToken(CoinKey.USDC, ChainId.DAI)
const USDT_ON_DAI = findDefaultToken(CoinKey.USDT, ChainId.DAI)
const SUSHISWAP_ON_DAI = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'

describe('allowance', () => {
  let signer: Signer

  const checkSetApproval = async (
    tokenAddress: string,
    approvalAddress: string,
    expectedAmount: string
  ) => {
    const approvedAmount = await getApproved(
      signer,
      tokenAddress,
      approvalAddress
    )

    expect(new BigNumber(expectedAmount).eq(approvedAmount)).toBeTruthy()
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

  describe.skip('approveToken', () => {
    beforeEach(async () => {
      // revoke approval to get a clean start
      console.log('revoking old approvals')

      const tx = await setApproval(
        signer,
        USDC_ON_DAI.address,
        SUSHISWAP_ON_DAI,
        '0'
      )
      await tx.wait()

      await sleep(2000)
    })

    it('it should approve the requested amount', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken(signer, USDC_ON_DAI, SUSHISWAP_ON_DAI, amount, false)

      await checkSetApproval(USDC_ON_DAI.address, SUSHISWAP_ON_DAI, amount)
    })

    it('it should set infinite approval', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken(signer, USDC_ON_DAI, SUSHISWAP_ON_DAI, amount, true)

      await checkSetApproval(
        USDC_ON_DAI.address,
        SUSHISWAP_ON_DAI,
        constants.MaxUint256.toString()
      )
    })
  })

  describe.skip('revokeTokenApproval', () => {
    it('it should revoke the previously approved amount', async () => {
      const amount = '100000000'

      console.log('setting new approval')

      await approveToken(signer, USDC_ON_DAI, SUSHISWAP_ON_DAI, amount, false)

      await sleep(2000)

      await checkSetApproval(USDC_ON_DAI.address, SUSHISWAP_ON_DAI, amount)

      console.log('revoking approval')

      await revokeTokenApproval(signer, USDC_ON_DAI, SUSHISWAP_ON_DAI)

      await sleep(2000)

      await checkSetApproval(USDC_ON_DAI.address, SUSHISWAP_ON_DAI, '0')
    })
  })
})
