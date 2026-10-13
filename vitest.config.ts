import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Roda só os testes de lógica pura (`lib/utils/calendario.ts`, scripts de
 * importação): sem React, sem Next — o ambiente node padrão do Vitest basta.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.mts'],
  },
})
