import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { checkPackageUpdates } from './checkPackageUpdates.js'

const latestVersion = '2.5.6'

describe('checkPackageUpdates', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ version: latestVersion }),
    } as Response)

    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should be able to check the version number against npm', async () => {
    const packageName = '@lifi/sdk'
    const currentVersion = '0.0.0'

    await checkPackageUpdates(packageName, currentVersion)

    expect(global.fetch as Mock).toBeCalledWith(
      `https://registry.npmjs.org/${packageName}/latest`
    )

    expect(console.warn).toBeCalledWith(
      `${packageName}: new package version is available. Please update as soon as possible to enjoy the newest features. Current version: ${currentVersion}. Latest version: ${latestVersion}.`
    )
  })

  it('should not report if version matchs the latest on npm', async () => {
    const packageName = '@lifi/sdk'
    const currentVersion = '2.5.6'

    await checkPackageUpdates(packageName, currentVersion)

    expect(global.fetch as Mock).toBeCalledWith(
      `https://registry.npmjs.org/${packageName}/latest`
    )

    expect(console.warn).not.toBeCalled()
  })

  it('should fail sliently if it encounters a problem', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue({
      json: () => Promise.resolve({ version: latestVersion }),
    } as Response)

    const packageName = '@lifi/sdk'
    const currentVersion = '0.0.0'

    await checkPackageUpdates(packageName, currentVersion)

    expect(global.fetch as Mock).toBeCalledWith(
      `https://registry.npmjs.org/${packageName}/latest`
    )

    expect(console.warn).not.toBeCalled()
  })
})
