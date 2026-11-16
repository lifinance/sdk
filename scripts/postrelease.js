import { restorePackageFile } from './formatPackageJson.js'

// oxlint-disable-next-line no-console -- allowed in scripts
await restorePackageFile().then(() => console.log('Restored package.json'))
