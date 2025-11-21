import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

generatePackageJson()

// Generates a package.json to be published to NPM with only the necessary fields.
function generatePackageJson() {
  const packageJsonPath = path.join(__dirname, '../package.json')
  const tmpPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  writeFileSync(
    `${packageJsonPath}.tmp`,
    JSON.stringify(tmpPackageJson, null, 2),
    'utf8'
  )

  const {
    // NOTE: We explicitly don't want to publish the type field. We create a separate package.json for `src/cjs` and `src/esm` that has the type field.
    // type,
    authors,
    bugs,
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

    const dirPath = key
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(
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
}`,
      'utf8'
    )
    files_.push(key.replace('./', ''))
  }

  writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        // type,
        authors,
        bugs,
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
      null,
      2
    ),
    'utf8'
  )
}
