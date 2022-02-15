/* eslint-disable no-console */
import BigNumber from 'bignumber.js'
import { EXCHANGE_MODE, NETWORK_TYPE, STATUS, TOKEN } from 'bridge-sdk'
import {
  ChainId,
  CoinKey,
  ExecuteCrossParamsOld,
  getChainById,
  Process,
} from '../../types'
import horizon from './horizon'
import { Execution } from '@lifinance/types'

export class HorizonExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean): void => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
    statusManager,
  }: ExecuteCrossParamsOld): Promise<Execution> => {
    const { action } = step
    // setup
    step.execution = statusManager.initExecutionObject(step)
    const fromChain = getChainById(action.fromChainId)
    const toChain = getChainById(action.toChainId)

    const allowanceAndCrossProcess = statusManager.findOrCreateProcess(
      'allowanceAndCrossProcess',
      step,
      'Set Allowance and Cross',
      { status: 'ACTION_REQUIRED' }
    )
    let waitForBlocksProcess: Process
    let mintProcess: Process
    let intervalId: NodeJS.Timer
    if (!this.shouldContinue) return step.execution

    try {
      // mainnet / testnet ?
      const bridgeSDK =
        action.fromChainId === ChainId.ONE || action.toChainId === ChainId.ONE
          ? await horizon.setupMainnet()
          : await horizon.setupTestnet()

      const tokenMapping: { [k: string]: any } = {
        [CoinKey.ETH]: {
          token: TOKEN.ETH,
        },
        [CoinKey.BNB]: {
          token: TOKEN.ETH,
          // for other direction
          // token: TOKEN.HRC20,
          // hrc20Address: '0xbef55684b382bae72051813a898d17282066c007',
        },
        [CoinKey.ONE]: {
          token: TOKEN.ONE,
        },
        // [CoinKey.USDC]: {
        //   token: TOKEN.ERC20,
        //   erc20Address: '',
        // },
      }

      // params
      const type =
        action.toChainId === ChainId.ONE || action.toChainId === ChainId.ONET
          ? EXCHANGE_MODE.ETH_TO_ONE
          : EXCHANGE_MODE.ONE_TO_ETH
      const network =
        action.fromChainId === ChainId.BSC ||
        action.fromChainId === ChainId.BSCT ||
        action.toChainId === ChainId.BSC ||
        action.toChainId === ChainId.BSCT
          ? NETWORK_TYPE.BINANCE
          : NETWORK_TYPE.ETHEREUM

      // coinKey should always be set since this data is coming from the Lifi Backend.
      if (!action.fromToken.coinKey) {
        console.error("fromToken doesn't contain coinKey, aborting")
        throw new Error("fromToken doesn't contain coinKey")
      }
      const token = tokenMapping[action.fromToken.coinKey].token

      const amount = new BigNumber(action.fromAmount)
        .shiftedBy(-action.fromToken.decimals)
        .toNumber()
      const erc20Address = tokenMapping[action.fromToken.coinKey].erc20Address
      const hrc20Address = tokenMapping[action.fromToken.coinKey].hrc20Address

      const params = {
        type,
        network,
        amount,
        token,
        erc20Address,
        oneAddress: action.toAddress!,
        ethAddress: action.toAddress!,
        hrc20Address: hrc20Address,
        // maxWaitingTime?: number;
      }
      console.debug('params', params)

      if (!this.shouldContinue) return step.execution
      let operationId: string
      let bridgePromise
      if (
        allowanceAndCrossProcess.operationId &&
        allowanceAndCrossProcess.txHash
      ) {
        operationId = allowanceAndCrossProcess.operationId
        const operation = await bridgeSDK.restoreOperationById(operationId)
        bridgePromise = operation.waitOperationComplete()
      } else {
        bridgePromise = bridgeSDK.sendToken(params, (id) => (operationId = id))
      }

      intervalId = setInterval(async () => {
        if (!this.shouldContinue) {
          clearInterval(intervalId)
          return step.execution
        }
        if (operationId) {
          statusManager.updateProcess(
            step,
            allowanceAndCrossProcess.id,
            'PENDING',
            {
              operationId: operationId,
            }
          )
          const operation = await bridgeSDK.api.getOperation(operationId)
          console.debug('operation', operation)

          // Send > Wait
          if (
            operation.actions[0].status === 'in_progress' &&
            allowanceAndCrossProcess.status === 'ACTION_REQUIRED'
          ) {
            statusManager.updateProcess(
              step,
              allowanceAndCrossProcess.id,
              'PENDING',
              {
                txHash: operation.actions[0].transactionHash,
                txLink:
                  fromChain.metamask.blockExplorerUrls[0] +
                  'tx/' +
                  operation.actions[0].transactionHash,
                message: 'Send Transaction - Wait for',
              }
            )
          }

          // Wait > Done; Wait for confirmations
          if (
            operation.actions[0].status === 'success' &&
            allowanceAndCrossProcess.status === 'PENDING'
          ) {
            statusManager.updateProcess(
              step,
              allowanceAndCrossProcess.id,
              'DONE',
              {
                message: 'Transaction Sent:',
              }
            )

            waitForBlocksProcess = statusManager.findOrCreateProcess(
              'waitForBlocksProcess',
              step,
              'Wait for Block Confirmations',
              { status: 'PENDING' }
            )
          }

          // Confirmed > Done; Wait for mint
          if (
            operation.actions[1].status === 'success' &&
            waitForBlocksProcess.status === 'PENDING'
          ) {
            statusManager.updateProcess(step, waitForBlocksProcess.id, 'DONE', {
              message: 'Enough Block Confirmations',
            })
            mintProcess = statusManager.findOrCreateProcess(
              'mintProcess',
              step,
              'Minting tokens',
              {
                status: 'PENDING',
              }
            )
          }

          // Minted > Done; ??
          if (
            operation.actions[2].status === 'success' &&
            mintProcess.status === 'PENDING'
          ) {
            statusManager.updateProcess(step, mintProcess.id, 'DONE', {
              message: 'Minted in',
              txHash: operation.actions[2].transactionHash,
              txLink:
                toChain.metamask.blockExplorerUrls[0] +
                'tx/' +
                operation.actions[2].transactionHash,
            })
          }

          // Ended
          if (operation.status !== STATUS.IN_PROGRESS) {
            clearInterval(intervalId)
            if (operation.status === STATUS.ERROR) {
              //TODO: find appropriate message for error
              // const lastStep: Process = step.execution.process[step.execution.process.length -1]
              // lastStep.errorMessage = operation.status
              // updateExecution( step.execution )
              if (
                allowanceAndCrossProcess &&
                allowanceAndCrossProcess.status !== 'DONE'
              )
                statusManager.updateProcess(
                  step,
                  allowanceAndCrossProcess.id,
                  'FAILED'
                )
              if (
                waitForBlocksProcess! &&
                waitForBlocksProcess.status !== 'DONE'
              )
                statusManager.updateProcess(
                  step,
                  waitForBlocksProcess.id,
                  'FAILED'
                )
              if (mintProcess! && mintProcess.status !== 'DONE')
                statusManager.updateProcess(step, mintProcess.id, 'FAILED')

              statusManager.updateExecution(step, 'FAILED')
            }
          }
        }
      }, 4000)

      await bridgePromise
      if (!this.shouldContinue) return step.execution
      // Fallback
      if (
        allowanceAndCrossProcess &&
        allowanceAndCrossProcess.status !== 'DONE'
      )
        statusManager.updateProcess(step, allowanceAndCrossProcess.id, 'DONE')
      if (waitForBlocksProcess! && waitForBlocksProcess.status !== 'DONE')
        statusManager.updateProcess(step, waitForBlocksProcess.id, 'DONE')
      if (mintProcess! && mintProcess.status !== 'DONE')
        statusManager.updateProcess(step, mintProcess.id, 'DONE')
    } catch (e: any) {
      clearInterval(intervalId!)
      const lastStep: Process =
        step.execution.process[step.execution.process.length - 1]

      statusManager.updateProcess(step, lastStep.id, 'FAILED', {
        errorMessage: (e as Error).message,
      })

      if (
        allowanceAndCrossProcess &&
        allowanceAndCrossProcess.status !== 'DONE'
      )
        statusManager.updateProcess(step, allowanceAndCrossProcess.id, 'FAILED')
      if (waitForBlocksProcess! && waitForBlocksProcess.status !== 'DONE')
        statusManager.updateProcess(step, waitForBlocksProcess.id, 'FAILED')
      if (mintProcess! && mintProcess.status !== 'DONE')
        statusManager.updateProcess(step, mintProcess.id, 'FAILED')

      throw e
    }

    // DONE
    statusManager.updateExecution(step, 'DONE')
    return step.execution
  }
}
