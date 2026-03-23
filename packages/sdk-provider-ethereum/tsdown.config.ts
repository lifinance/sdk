import { defineConfig } from 'tsdown'

const entry = [
  'src/**/*.ts',
  '!src/**/*.spec.ts',
  '!src/**/*.test.ts',
  '!src/**/*.mock.ts',
  '!src/**/*.handlers.ts',
]

const shared = {
  unbundle: true,
  target: 'es2020' as const,
  logLevel: 'warn' as const,
  deps: {
    skipNodeModulesBundle: true,
  },
}

export default defineConfig([
  {
    ...shared,
    entry,
    outDir: 'dist/esm',
    format: 'esm',
    sourcemap: true,
    dts: { sourcemap: true },
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    ...shared,
    entry,
    outDir: 'dist/cjs',
    format: 'cjs',
    sourcemap: true,
    outExtensions: () => ({ js: '.js' }),
  },
])
