import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@panel': path.resolve(__dirname, 'src/panel'),
      '@types-cosmos': path.resolve(__dirname, 'src/types'),
    },
  },
  build: {
    outDir: 'out/webview',
    emptyOutDir: true,
    rollupOptions: {
      external: ['vscode'],
      input: path.resolve(__dirname, './webview/main.ts'),
      output: {
        entryFileNames: 'main.js',
        format: 'iife',
      },
    },
    sourcemap: true,
  },
});
