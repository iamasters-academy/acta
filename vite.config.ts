import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'web'),
  plugins: [react(), tailwindcss()],
  build: { outDir: path.resolve(import.meta.dirname, 'web/dist'), emptyOutDir: true },
});
