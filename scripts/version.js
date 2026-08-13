import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Inlines the package's name/version into src/version.ts. Runs both at build time
// and from the root `build:version` script during `changeset version`, so the
// committed file never lags behind the bumped package.json. Read/write failures
// must surface — a silent no-op here reintroduces the drift.
const { name, version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8')
)

writeFileSync(
  join(process.cwd(), 'src', 'version.ts'),
  `export const name = '${name}'\nexport const version = '${version}'\n`
)
