import { LifiStep } from '@lifi/types'
import { Signer } from 'ethers'
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { buildStepObject } from '../../test/fixtures'
import { InternalExecutionSettings } from '../types'
import { StatusManager } from './StatusManager'
import { switchChain } from './switchChain'

let signer: Signer,
  step: LifiStep,
  statusManager: StatusManager,
  hooks: InternalExecutionSettings,
  getChainIdMock: Mock,
  switchChainHookMock: Mock,
  findOrCreateProcessMock: Mock,
  updateExecutionMock: Mock,
  updateProcessMock: Mock

describe('switchChain', () => {
  beforeEach(() => {
    getChainIdMock = vi.fn()
    signer = {
      getChainId: getChainIdMock,
    } as unknown as Signer

    switchChainHookMock = vi.fn()
    hooks = {
      switchChainHook: switchChainHookMock,
    } as unknown as InternalExecutionSettings

    step = buildStepObject({ includingExecution: false })

    findOrCreateProcessMock = vi.fn()
    updateExecutionMock = vi.fn()
    updateProcessMock = vi.fn()
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
      getChainIdMock.mockResolvedValue(step.action.fromChainId)
    })

    it('should return the signer and do nothing else', async () => {
      const updatedSigner = await switchChain(
        signer,
        statusManager,
        step,
        hooks.switchChainHook,
        true
      )

      expect(updatedSigner).toEqual(signer)
      expect(statusManager.initExecutionObject).not.toHaveBeenCalled()
      expect(hooks.switchChainHook).not.toHaveBeenCalled()
    })
  })

  describe('when the chain is not correct', () => {
    beforeEach(() => {
      getChainIdMock.mockResolvedValueOnce(1)
      findOrCreateProcessMock.mockReturnValue({ type: 'SWITCH_CHAIN' })
    })

    describe('when allowUserInteraction is false', () => {
      it('should initialize the status manager and abort', async () => {
        const updatedSigner = await switchChain(
          signer,
          statusManager,
          step,
          hooks.switchChainHook,
          false
        )

        expect(updatedSigner).toBeUndefined()

        expect(statusManager.initExecutionObject).toHaveBeenCalled()
        expect(statusManager.findOrCreateProcess).toHaveBeenCalled()
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
              signer,
              statusManager,
              step,
              hooks.switchChainHook,
              true
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
          switchChainHookMock.mockResolvedValue(signer)
        })

        it('should throw the error', async () => {
          await expect(
            switchChain(
              signer,
              statusManager,
              step,
              hooks.switchChainHook,
              true
            )
          ).rejects.toThrowError(new Error('Chain switch required.'))

          expect(switchChainHookMock).toHaveBeenCalledWith(
            step.action.fromChainId
          )
          expect(updateExecutionMock).toHaveBeenCalledWith(step, 'FAILED')
        })
      })

      describe('when the switchChainHook changes the chain', () => {
        let newSigner: Signer

        beforeEach(() => {
          newSigner = {
            getChainId: () => Promise.resolve(step.action.fromChainId),
          } as unknown as Signer

          switchChainHookMock.mockResolvedValue(newSigner)
        })

        it('should return the updated signer', async () => {
          const updatedSigner = await switchChain(
            signer,
            statusManager,
            step,
            hooks.switchChainHook,
            true
          )

          expect(switchChainHookMock).toHaveBeenCalledWith(
            step.action.fromChainId
          )
          expect(updatedSigner).toEqual(newSigner)
          expect(statusManager.updateProcess).toHaveBeenCalledWith(
            step,
            'SWITCH_CHAIN',
            'DONE'
          )
          expect(statusManager.updateExecution).toHaveBeenCalledWith(
            step,
            'PENDING'
          )
        })
      })
    })
  })
})
