import { name, version } from '../version.js'

export const checkPackageUpdates = async (
  packageName?: string,
  packageVersion?: string
) => {
  try {
    const pkgName = packageName ?? name
    const response = await fetch(`https://registry.npmjs.org/${pkgName}/latest`)
    const reponseBody = await response.json()
    const latestVersion = reponseBody.version
    const currentVersion = packageVersion ?? version

    if (latestVersion > currentVersion) {
      console.warn(
        `${pkgName}: new package version is available. Please update as soon as possible to enjoy the newest features. Current version: ${currentVersion}. Latest version: ${latestVersion}.`
      )
    }
  } catch (_error) {
    // Cannot verify version, might be network error etc. We don't bother showing anything in that case
  }
}
