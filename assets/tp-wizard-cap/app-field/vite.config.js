import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/wizard': 'http://localhost:4004',
      '/agent': {
        target: 'http://localhost:5001',
        rewrite: (path) => path.replace(/^\/agent/, '') || '/',
      },
    }
  }
});
