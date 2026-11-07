import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'src/renderer', publicDir: 'recursos', base: './',
  plugins: [react(), {
    name: 'entrada-android',
    enforce: 'post',
    generateBundle(_opciones, archivos) {
      const entrada = archivos['movil.html'];
      if (entrada) { delete archivos['movil.html']; entrada.fileName = 'index.html'; archivos['index.html'] = entrada; }
    }
  }],
  resolve: { alias: [{ find: /^\.\/escritorio$/, replacement: path.resolve('src/plataforma/noEscritorio.ts') }] },
  worker: { format: 'es', plugins: () => [] },
  build: {
    target: 'es2022', outDir: '../../movil/www', emptyOutDir: true, assetsInlineLimit: 0,
    rollupOptions: { input: 'src/renderer/movil.html' }
  }
});
