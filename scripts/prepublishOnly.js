import pkg from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const { outputFileSync, readJsonSync, writeJsonSync } = pkg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

generatePackageJson()

// Generates a package.json to be published to NPM with only the necessary fields.
function generatePackageJson() {
  const packageJsonPath = path.join(__dirname, '../package.json')
  const tmpPackageJson = readJsonSync(packageJsonPath)

  writeJsonSync(`${packageJsonPath}.tmp`, tmpPackageJson, { spaces: 2 })

  const {
    // NOTE: We explicitly don't want to publish the type field. We create a separate package.json for `src/_cjs` and `src/_esm` that has the type field.
    // type,
    authors,
    dependencies,
    description,
    exports: exports_,
    files,
    homepage,
    keywords,
    license,
    main,
    module,
    name,
    peerDependencies,
    peerDependenciesMeta,
    repository,
    sideEffects,
    types,
    typesVersions,
    typings,
    version,
  } = tmpPackageJson

  // Generate proxy packages for each export.
  const files_ = [...files]
  for (const [key, value] of Object.entries(exports_)) {
    if (typeof value === 'string') {
      continue
    }
    if (key === '.') {
      continue
    }
    if (!value.default || !value.import) {
      throw new Error('`default` and `import` are required.')
    }

    outputFileSync(
      `${key}/package.json`,
      `{
  ${Object.entries(value)
    .map(([k, v]) => {
      const key = (() => {
        if (k === 'import') {
          return 'module'
        }
        if (k === 'default') {
          return 'main'
        }
        if (k === 'types') {
          return 'types'
        }
        throw new Error('Invalid key')
      })()
      return `"${key}": "${v.replace('./', '../')}"`
    })
    .join(',\n  ')}
}`
    )
    files_.push(key.replace('./', ''))
  }

  writeJsonSync(
    packageJsonPath,
    {
      // type,
      authors,
      dependencies,
      description,
      exports: exports_,
      files: files_,
      homepage,
      keywords,
      license,
      main,
      module,
      name,
      peerDependencies,
      peerDependenciesMeta,
      repository,
      sideEffects,
      types,
      typesVersions,
      typings,
      version,
    },
    { spaces: 2 }
  )
}
