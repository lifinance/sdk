import { readFile, writeFileSync } from 'node:fs'
import { join } from 'node:path'

async function run() {
  const packagePath = join(process.cwd(), './package.json')

  readFile(packagePath, 'utf8', (_err, data) => {
    const { version, name } = JSON.parse(data)

    const file = `export const name = '${name}'\nexport const version = '${version}'\n`

    writeFileSync(`${process.cwd()}/src/version.ts`, file)
  })
}

run()
