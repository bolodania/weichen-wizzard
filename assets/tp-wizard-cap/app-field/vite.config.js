import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/wizard': 'http://localhost:4004',
      '/agent': {
        target: 'http://localhost:5000',
        rewrite: (path) => path.replace(/^\/agent/, '') || '/',
      },
    }
  }
});
