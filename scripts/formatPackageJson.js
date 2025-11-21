/** biome-ignore-all lint/correctness/noUnusedVariables: allowed in scripts */
import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function formatPackageFile() {
  const originalPackageJsonPath = resolve(process.cwd(), './package.json')
  const packageTmpPath = resolve(process.cwd(), './package.json.tmp')

  const packageData = await readFile(originalPackageJsonPath, 'utf8')

  await copyFile(originalPackageJsonPath, packageTmpPath)

  const { nyc, scripts, devDependencies, workspaces, ...newPackageData } =
    JSON.parse(packageData)

  await writeFile(
    originalPackageJsonPath,
    JSON.stringify(newPackageData, null, 2),
    'utf8'
  )

  return newPackageData
}

export async function restorePackageFile() {
  try {
    const originalPackageJsonPath = resolve(process.cwd(), './package.json')
    const packageTmpPath = resolve(process.cwd(), './package.json.tmp')

    await copyFile(packageTmpPath, originalPackageJsonPath)
    await unlink(packageTmpPath)
  } catch (_error) {
    console.warn('Post release failed.')
  }
}
