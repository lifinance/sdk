import { buildStepObject } from '../../test/fixtures'
import { Step } from '@lifinance/types'
import { Signer } from 'ethers'
import { switchChain } from './switchChain'
import StatusManager from '../StatusManager'
import { Hooks } from '../types'

let signer: Signer,
  step: Step,
  statusManager: StatusManager,
  hooks: Hooks,
  getChainIdMock: jest.Mock,
  switchChainHookMock: jest.Mock,
  findOrCreateProcessMock: jest.Mock,
  updateExecutionMock: jest.Mock,
  updateProcessMock: jest.Mock

describe('switchChain', () => {
  beforeEach(() => {
    getChainIdMock = jest.fn()
    signer = {
      getChainId: getChainIdMock,
    } as unknown as Signer

    switchChainHookMock = jest.fn()
    hooks = {
      switchChainHook: switchChainHookMock,
    } as unknown as Hooks

    step = buildStepObject({ includingExecution: false })

    findOrCreateProcessMock = jest.fn()
    updateExecutionMock = jest.fn()
    updateProcessMock = jest.fn()
    statusManager = {
      initExecutionObject: jest.fn(),
      findOrCreateProcess: findOrCreateProcessMock,
      removeProcess: jest.fn(),
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
      findOrCreateProcessMock.mockReturnValue({ id: 'switchProcess' })
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
          ).rejects.toThrowError(new Error('CHAIN SWITCH REQUIRED'))

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
          expect(statusManager.removeProcess).toHaveBeenCalledWith(
            step,
            'switchProcess'
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
