import { formatPackageFile } from './formatPackageJson.js'

// oxlint-disable-next-line no-console -- allowed in scripts
await formatPackageFile().then(() => console.log('Created package.json'))
