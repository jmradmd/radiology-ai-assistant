import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@rad-assist/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@rad-assist/api': path.resolve(__dirname, '../../packages/api/src'),
    },
  },
  server: { port: 5173 },
});
