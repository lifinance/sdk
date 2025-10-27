import {
  type ExecutionOptions,
  LiFiErrorCode,
  type LiFiStep,
  type Process,
  ProviderError,
  type StatusManager,
} from '@lifi/sdk'
import type { Client } from 'viem'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { switchChain } from './switchChain.js'
import { buildStepObject } from './switchChain.unit.mock.js'

let client: Client
let step: LiFiStep
let statusManager: StatusManager
let hooks: ExecutionOptions
let requestMock: Mock
let switchChainHookMock: Mock
let findOrCreateProcessMock: Mock
let updateExecutionMock: Mock
let updateProcessMock: Mock
let mockProcess: Process

describe('switchChain', () => {
  beforeEach(() => {
    switchChainHookMock = vi.fn()
    hooks = {
      switchChainHook: switchChainHookMock,
    } as unknown as ExecutionOptions

    step = buildStepObject({ includingExecution: false })

    requestMock = vi.fn(() => 1)
    client = {
      request: requestMock,
    } as unknown as Client

    findOrCreateProcessMock = vi.fn()
    updateExecutionMock = vi.fn()
    updateProcessMock = vi.fn()
    mockProcess = {
      type: 'SWAP',
      status: 'STARTED',
      startedAt: Date.now(),
    }
    statusManager = {
      initExecutionObject: vi.fn(),
      findOrCreateProcess: findOrCreateProcessMock,
      removeProcess: vi.fn(),
      updateExecution: updateExecutionMock,
      updateProcess: updateProcessMock,
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
        mockProcess,
        step.action.fromChainId,
        true,
        hooks
      )

      expect(updatedClient).toEqual(client)
      expect(statusManager.initExecutionObject).not.toHaveBeenCalled()
      expect(hooks.switchChainHook).not.toHaveBeenCalled()
    })
  })

  describe('when the chain is not correct', () => {
    beforeEach(() => {
      requestMock.mockResolvedValueOnce(1)
      findOrCreateProcessMock.mockReturnValue({ type: 'SWITCH_CHAIN' })
    })

    describe('when allowUserInteraction is false', () => {
      it('should initialize the status manager and abort', async () => {
        const updatedClient = await switchChain(
          client,
          statusManager,
          step,
          mockProcess,
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
              mockProcess,
              step.action.fromChainId,
              true,
              hooks
            )
          ).rejects.toThrowError(new Error('something went wrong'))

          expect(switchChainHookMock).toHaveBeenCalledWith(
            step.action.fromChainId
          )
          expect(updateExecutionMock).toHaveBeenCalledWith(step, 'FAILED')
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
              mockProcess,
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
          expect(updateExecutionMock).toHaveBeenCalledWith(step, 'FAILED')
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
            mockProcess,
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
