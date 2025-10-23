import { ChainId } from '@lifi/types'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getStatus } from './getStatus.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getStatus', () => {
  setupTestServer()

  const fromChain = ChainId.DAI
  const toChain = ChainId.POL
  const txHash = 'some tx hash'
  const bridge = 'some bridge tool'

  describe('user input is invalid', () => {
    it('throw an error', async () => {
      await expect(
        getStatus(client, {
          bridge,
          fromChain,
          toChain,
          txHash: undefined as unknown as string,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "txHash" is missing.')
        )
      )

      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })
  })

  describe('user input is valid', () => {
    describe('and the backend call is successful', () => {
      it('call the server once', async () => {
        await getStatus(client, {
          bridge,
          fromChain,
          toChain,
          txHash,
        })
        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })
  })
})
