import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/wizard': 'http://localhost:4004',
      '/odata':  'http://localhost:4004',
      '/health': 'http://localhost:4004'
    }
  },
  build: {
    outDir: 'build'
  }
});
