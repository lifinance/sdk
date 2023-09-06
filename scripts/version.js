/* eslint-disable @typescript-eslint/no-var-requires */
import { readFile, writeFileSync } from 'fs'
import { join } from 'path'

async function run() {
  const packagePath = join(process.cwd(), './package.json')

  readFile(packagePath, 'utf8', (err, data) => {
    const { version, name } = JSON.parse(data)

    const file = `export const name = '${name}'\nexport const version = '${version}'\n`

    writeFileSync(`${process.cwd()}/src/version.ts`, file)
  })
}

run()
