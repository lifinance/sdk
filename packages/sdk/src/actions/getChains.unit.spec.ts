import { describe, expect, it, vi } from 'vitest'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getChains } from './getChains.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getChains', () => {
  setupTestServer()

  describe('and the backend call is successful', () => {
    it('call the server once', async () => {
      const chains = await getChains(client)

      expect(chains[0]?.id).toEqual(1)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
    })
  })
})
