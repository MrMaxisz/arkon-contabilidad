import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['pruebas/**/*.prueba.ts', 'pruebas/**/*.prueba.tsx'],
    environment: 'node'
  }
});
