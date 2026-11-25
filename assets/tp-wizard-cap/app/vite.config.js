import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  server: {
    port: 3000,
    proxy: {
      '/wizard': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
      '/odata': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
      '/flex': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
    }
  },
  build: {
    outDir: 'build'
  }
});
