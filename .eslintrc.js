module.exports = {
  parser: '@typescript-eslint/parser',
  extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
  parserOptions: {
    sourceType: 'module',
  },
  rules: {
    'prettier/prettier': 'error',
    'max-len': ['error', { code: 140, ignoreComments: true }],
    curly: 2,
  },
  plugins: ['@typescript-eslint', 'prettier'],
}
