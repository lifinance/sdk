/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path')
const fs = require('fs-extra')

async function run() {
  const packagePath = path.join(process.cwd(), './package.json')

  const packageData = await fs.readFile(packagePath, 'utf8')

  const { version, name } = JSON.parse(packageData)

  const src = `export const name = '${name}'\nexport const version = '${version}'\n`

  await fs.writeFile(`${process.cwd()}/src/version.ts`, src, {
    flat: 'w',
  })
}

run()
