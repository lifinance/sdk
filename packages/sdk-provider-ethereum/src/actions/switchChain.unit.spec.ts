import {
  type ExecutionOptions,
  LiFiErrorCode,
  type LiFiStepExtended,
  ProviderError,
  type StatusManager,
} from '@lifi/sdk'
import type { Client } from 'viem'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { switchChain } from './switchChain.js'
import { buildStepObject } from './switchChain.unit.mock.js'

let client: Client
let step: LiFiStepExtended
let statusManager: StatusManager
let hooks: ExecutionOptions
let requestMock: Mock
let switchChainHookMock: Mock
let transitionExecutionStatusMock: Mock

describe('switchChain', () => {
  beforeEach(() => {
    switchChainHookMock = vi.fn()
    hooks = {
      switchChainHook: switchChainHookMock,
    } as unknown as ExecutionOptions

    step = buildStepObject({ includingExecution: true })

    requestMock = vi.fn(() => 1)
    client = {
      request: requestMock,
    } as unknown as Client

    transitionExecutionStatusMock = vi.fn()
    statusManager = {
      transitionExecutionStatus: transitionExecutionStatusMock,
    } as unknown as StatusManager
  })

  describe('when the chain is already correct', () => {
    beforeEach(() => {
      requestMock.mockResolvedValue(step.action.fromChainId)
    })

    it('should return the connector client and do nothing else', async () => {
      const updatedClient = await switchChain(
        client,
        statusManager,
        step,
        step.action.fromChainId,
        true,
        hooks
      )

      expect(updatedClient).toEqual(client)
      expect(transitionExecutionStatusMock).not.toHaveBeenCalled()
      expect(hooks.switchChainHook).not.toHaveBeenCalled()
    })
  })

  describe('when the chain is not correct', () => {
    beforeEach(() => {
      requestMock.mockResolvedValueOnce(1)
    })

    describe('when allowUserInteraction is false', () => {
      it('should return undefined and abort', async () => {
        const updatedClient = await switchChain(
          client,
          statusManager,
          step,
          step.action.fromChainId,
          false,
          hooks
        )

        expect(updatedClient).toBeUndefined()
        expect(hooks.switchChainHook).not.toHaveBeenCalled()
      })
    })

    describe('when allowUserInteraction is true', () => {
      describe('when the switchChainHook fails', () => {
        beforeEach(() => {
          switchChainHookMock.mockRejectedValue(
            new Error('something went wrong')
          )
        })

        it('should throw the error', async () => {
          await expect(
            switchChain(
              client,
              statusManager,
              step,
              step.action.fromChainId,
              true,
              hooks
            )
          ).rejects.toThrowError(new Error('something went wrong'))

          expect(switchChainHookMock).toHaveBeenCalledWith(
            step.action.fromChainId
          )
          expect(transitionExecutionStatusMock).toHaveBeenCalledWith(
            step,
            'FAILED',
            {
              error: {
                message: 'something went wrong',
                code: LiFiErrorCode.ChainSwitchError,
              },
            }
          )
        })
      })

      describe("when the switchChainHook doesn't change the chain", () => {
        beforeEach(() => {
          switchChainHookMock.mockResolvedValue(client)
        })

        it('should throw the error', async () => {
          await expect(
            switchChain(
              client,
              statusManager,
              step,
              step.action.fromChainId,
              true,
              hooks
            )
          ).rejects.toThrowError(
            new ProviderError(
              LiFiErrorCode.ChainSwitchError,
              'Chain switch required.'
            )
          )

          expect(switchChainHookMock).toHaveBeenCalledWith(
            step.action.fromChainId
          )
          expect(transitionExecutionStatusMock).toHaveBeenCalledWith(
            step,
            'FAILED',
            {
              error: {
                message: 'Chain switch required.',
                code: LiFiErrorCode.ChainSwitchError,
              },
            }
          )
        })
      })

      describe('when the switchChainHook changes the chain', () => {
        let newClient: Client

        beforeEach(() => {
          newClient = {
            request: () => Promise.resolve(step.action.fromChainId),
          } as unknown as Client

          switchChainHookMock.mockResolvedValue(newClient)
        })

        it('should return the updated connector client', async () => {
          const updatedClient = await switchChain(
            client,
            statusManager,
            step,
            step.action.fromChainId,
            true,
            hooks
          )

          expect(switchChainHookMock).toHaveBeenCalledWith(
            step.action.fromChainId
          )
          expect(updatedClient).toEqual(newClient)
        })
      })
    })
  })
})
