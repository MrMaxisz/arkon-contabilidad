import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['pruebas/**/*.prueba.ts', 'pruebas/**/*.prueba.tsx'],
    environment: 'node',
    setupFiles: ['./pruebas/preparacion.ts'],
    // Timeout global ampliado: dos pruebas de componentes fallaban por tiempo de forma
    // intermitente con 5000 ms (auditoría 74).
    testTimeout: 20000
  }
});
