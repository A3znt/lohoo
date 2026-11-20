import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('./public/', import.meta.url)), emptyOutDir: true },
});
