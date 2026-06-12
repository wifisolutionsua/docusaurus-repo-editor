import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/editor-assets/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
