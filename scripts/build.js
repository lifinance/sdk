/** biome-ignore-all lint/suspicious/noConsole: console.log */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { name } = JSON.parse(readFileSync('package.json', 'utf8'))
const start = performance.now()
execSync('tsdown --logLevel warn', { stdio: 'inherit' })
console.log(`✔ ${name} built in ${Math.round(performance.now() - start)}ms`)
