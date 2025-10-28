import { findDefaultToken } from '@lifi/data-types'
import type { Action, Estimate, LiFiStep, StepTool, Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { describe, expect, it, vi } from 'vitest'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getStepTransaction } from './getStepTransaction.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getStepTransaction', () => {
  setupTestServer()

  const getAction = ({
    fromChainId = ChainId.BSC,
    fromAmount = '10000000000000',
    fromToken = findDefaultToken(CoinKey.USDC, ChainId.BSC),
    fromAddress = 'some from address', // we don't validate the format of addresses atm
    toChainId = ChainId.DAI,
    toToken = findDefaultToken(CoinKey.USDC, ChainId.DAI),
    toAddress = 'some to address',
    slippage = 0.03,
  }): Action => ({
    fromChainId,
    fromAmount,
    fromToken: fromToken as Token,
    fromAddress,
    toChainId,
    toToken: toToken as Token,
    toAddress,
    slippage,
  })

  const getEstimate = ({
    fromAmount = '10000000000000',
    toAmount = '10000000000000',
    toAmountMin = '999999999999',
    approvalAddress = 'some approval address', // we don't validate the format of addresses atm;
    executionDuration = 300,
    tool = '1inch',
  }): Estimate => ({
    fromAmount,
    toAmount,
    toAmountMin,
    approvalAddress,
    executionDuration,
    tool,
  })

  const getStep = ({
    id = 'some random id',
    type = 'lifi',
    tool = 'some swap tool',
    action = getAction({}),
    estimate = getEstimate({}),
  }: {
    id?: string
    type?: 'lifi'
    tool?: StepTool
    action?: Action
    estimate?: Estimate
  }): LiFiStep => ({
    id,
    type,
    tool,
    toolDetails: {
      key: tool,
      name: tool,
      logoURI: '',
    },
    action,
    estimate,
    includedSteps: [],
  })

  describe('with a swap step', () => {
    // While the validation fails for some users we should not enforce it
    describe.skip('user input is invalid', () => {
      it('should throw Error because of invalid id', async () => {
        const step = getStep({ id: null as unknown as string })

        await expect(getStepTransaction(client, step)).rejects.toThrow(
          'Invalid step.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid type', async () => {
        const step = getStep({ type: 42 as unknown as 'lifi' })

        await expect(getStepTransaction(client, step)).rejects.toThrow(
          'Invalid Step'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid tool', async () => {
        const step = getStep({ tool: null as unknown as StepTool })

        await expect(getStepTransaction(client, step)).rejects.toThrow(
          'Invalid step.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      // more indepth checks for the action type should be done once we have real schema validation
      it('should throw Error because of invalid action', async () => {
        const step = getStep({ action: 'xxx' as unknown as Action })

        await expect(getStepTransaction(client, step)).rejects.toThrow(
          'Invalid step.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })

      // more indepth checks for the estimate type should be done once we have real schema validation
      it('should throw Error because of invalid estimate', async () => {
        const step = getStep({
          estimate: 'Is this really an estimate?' as unknown as Estimate,
        })

        await expect(getStepTransaction(client, step)).rejects.toThrow(
          'Invalid step.'
        )
        expect(mockedFetch).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      describe('and the backend call is successful', () => {
        it('call the server once', async () => {
          const step = getStep({})

          await getStepTransaction(client, step)
          expect(mockedFetch).toHaveBeenCalledTimes(1)
        })
      })
    })
  })
})
