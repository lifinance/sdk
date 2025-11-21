import { restorePackageFile } from './formatPackageJson.js'

// biome-ignore lint/suspicious/noConsole: allowed in scripts
await restorePackageFile().then(() => console.log('Restored package.json'))
