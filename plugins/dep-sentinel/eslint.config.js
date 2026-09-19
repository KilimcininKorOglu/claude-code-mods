import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['.claude/', 'node_modules/'] },
  tseslint.configs.recommended,
  {
    files: ['hooks/**/*.ts', 'tests/**/*.ts'],
    rules: {
      complexity: ['error', 10],
    },
  },
)
