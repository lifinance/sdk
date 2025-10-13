import { describe, expect, it } from 'vitest'
import { sleep } from './sleep.js'

describe('sleep', () => {
  it('should wait for specified time', async () => {
    const start = Date.now()
    await sleep(50)
    const end = Date.now()

    expect(end - start).toBeGreaterThanOrEqual(45)
  })

  it('should return null', async () => {
    const result = await sleep(10)
    expect(result).toBeNull()
  })
})
