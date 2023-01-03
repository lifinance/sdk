const esModules = ['ky', 'ky-universal', 'web-streams-polyfill', '@lifi/types'].join('|');

export default {
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],
  preset: 'ts-jest/presets/default-esm',
  transform: {
    '^.+\\.(ts|tsx|js)$': ['ts-jest', { useESM: true, }],
  },
  transformIgnorePatterns: [`<rootDir>/node_modules/(?!${esModules})`],
  setupFilesAfterEnv: ['./test/setupEnv.ts'],
}
