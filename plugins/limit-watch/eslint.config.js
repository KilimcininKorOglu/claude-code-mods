import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['.claude/', 'node_modules/'] },
  ...tseslint.configs.recommended,
  {
    files: ['hooks/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      complexity: ['error', 10],
    },
  },
)
