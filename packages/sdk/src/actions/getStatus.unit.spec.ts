import {
  ChainId,
  type SmartDepositsStatusResponse,
  type StatusResponse,
} from '@lifi/types'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getStatus } from './getStatus.js'
import { actions } from './index.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getStatus', () => {
  setupTestServer()

  beforeEach(() => {
    mockedFetch.mockClear()
  })

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
          new ValidationError(
            'Either "taskId", "txHash" or "depositAddress" with "fromChain" must be provided and non-empty.'
          )
        )
      )

      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })
  })

  describe('deposit address lookup', () => {
    const depositAddress = '0x00000000000000000000000000000000000000d1'
    const invalid = new SDKError(
      new ValidationError(
        'Either "taskId", "txHash" or "depositAddress" with "fromChain" must be provided and non-empty.'
      )
    )

    it('requests the status by deposit address and source chain', async () => {
      await getStatus(client, { depositAddress, fromChain })
      const url = new URL(mockedFetch.mock.calls[0][1] as string)
      expect(url.pathname.endsWith('/status')).toBe(true)
      expect(url.searchParams.get('depositAddress')).toBe(depositAddress)
      expect(url.searchParams.get('fromChain')).toBe(String(fromChain))
    })

    it('throws without a source chain', async () => {
      await expect(
        getStatus(client, { depositAddress } as unknown as Parameters<
          typeof getStatus
        >[1])
      ).rejects.toThrowError(invalid)
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('throws on an empty deposit address', async () => {
      await expect(
        getStatus(client, { depositAddress: '', fromChain })
      ).rejects.toThrowError(invalid)
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('resolves to the Smart Deposits status for the lookup only', () => {
      expectTypeOf(() =>
        getStatus(client, { depositAddress, fromChain })
      ).returns.toEqualTypeOf<Promise<SmartDepositsStatusResponse>>()
      expectTypeOf(() =>
        getStatus(client, { depositAddress, fromChain, toChain })
      ).returns.toEqualTypeOf<Promise<SmartDepositsStatusResponse>>()
      expectTypeOf(() =>
        getStatus(client, { txHash, fromChain })
      ).returns.toEqualTypeOf<Promise<StatusResponse>>()
      expectTypeOf(() =>
        getStatus(client, { taskId: 'some task id' })
      ).returns.toEqualTypeOf<Promise<StatusResponse>>()
      expectTypeOf(() =>
        getStatus(client, { txHash, depositAddress, fromChain })
      ).returns.toEqualTypeOf<Promise<StatusResponse>>()
    })

    it('keeps the overloads on the client-bound action', () => {
      const bound = actions(client)
      expectTypeOf(() =>
        bound.getStatus({ depositAddress, fromChain })
      ).returns.toEqualTypeOf<Promise<SmartDepositsStatusResponse>>()
      expectTypeOf(() =>
        bound.getStatus({ txHash, fromChain })
      ).returns.toEqualTypeOf<Promise<StatusResponse>>()
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
