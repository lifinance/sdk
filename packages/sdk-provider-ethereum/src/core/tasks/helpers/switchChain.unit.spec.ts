import { LiFiErrorCode, type LiFiStep, ProviderError } from '@lifi/sdk'
import { type Client, SwitchChainError, UserRejectedRequestError } from 'viem'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { switchChain } from './switchChain.js'
import { buildStepObject } from './switchChain.unit.mock.js'

let client: Client
let step: LiFiStep
let requestMock: Mock
let switchChainHookMock: Mock

describe('switchChain', () => {
  beforeEach(() => {
    switchChainHookMock = vi.fn()
    step = buildStepObject({ includingExecution: false })
    requestMock = vi.fn(() => 1)
    client = {
      request: requestMock,
    } as unknown as Client
  })

  describe('when the chain is already correct', () => {
    beforeEach(() => {
      requestMock.mockResolvedValue(step.action.fromChainId)
    })

    it('should return the connector client and do nothing else', async () => {
      const updatedClient = await switchChain(
        client,
        step.action.fromChainId,
        true,
        switchChainHookMock
      )

      expect(updatedClient).toEqual(client)
      expect(switchChainHookMock).not.toHaveBeenCalled()
    })
  })

  describe('when the chain is not correct', () => {
    beforeEach(() => {
      requestMock.mockResolvedValueOnce(1)
    })

    describe('when allowUserInteraction is false', () => {
      it('should return undefined and not call the hook', async () => {
        const updatedClient = await switchChain(
          client,
          step.action.fromChainId,
          false,
          switchChainHookMock
        )

        expect(updatedClient).toBeUndefined()
        expect(switchChainHookMock).not.toHaveBeenCalled()
      })
    })

    describe('when allowUserInteraction is true', () => {
      describe('when the switchChainHook fails', () => {
        const hookError = new Error('Unknown Network: eip155:130')

        beforeEach(() => {
          switchChainHookMock.mockRejectedValue(hookError)
        })

        it('should throw a chain switch error with the hook error as cause', async () => {
          const error = await switchChain(
            client,
            step.action.fromChainId,
            true,
            switchChainHookMock
          ).catch((e: unknown) => e)

          expect(error).toBeInstanceOf(ProviderError)
          expect(error).toMatchObject({
            code: LiFiErrorCode.ChainSwitchError,
            cause: hookError,
          })
          expect((error as ProviderError).message).toContain(
            'Unknown Network: eip155:130'
          )
          expect(switchChainHookMock).toHaveBeenCalledWith(
            step.action.fromChainId
          )
        })

        it('should add only the wallet reason of a viem error to the message', async () => {
          switchChainHookMock.mockRejectedValue(
            new SwitchChainError(new Error('Unknown Network: eip155:130'))
          )

          const error = await switchChain(
            client,
            step.action.fromChainId,
            true,
            switchChainHookMock
          ).catch((e: unknown) => e)

          expect((error as ProviderError).message).toBe(
            `The wallet could not switch to chain ${step.action.fromChainId}. Unknown Network: eip155:130`
          )
        })
      })

      describe('when the user rejects the chain switch', () => {
        it('should throw a chain switch error with the rejection as cause', async () => {
          const rejection = new UserRejectedRequestError(
            new Error('User rejected the request.')
          )
          switchChainHookMock.mockRejectedValue(rejection)

          const error = await switchChain(
            client,
            step.action.fromChainId,
            true,
            switchChainHookMock
          ).catch((e: unknown) => e)

          expect(error).toBeInstanceOf(ProviderError)
          expect(error).toMatchObject({
            code: LiFiErrorCode.ChainSwitchError,
            cause: rejection,
          })
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
              step.action.fromChainId,
              true,
              switchChainHookMock
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
            step.action.fromChainId,
            true,
            switchChainHookMock
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
