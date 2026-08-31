import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      './runtimeConfig': './runtimeConfig.browser',
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    // shared/ lives above the Vite root.
    fs: { allow: ['..'] },
    // The dev server has no API. Point VITE_API_PROXY at the deployed CloudFront
    // domain to exercise real endpoints locally.
    proxy: process.env.VITE_API_PROXY
      ? { '/api': { target: process.env.VITE_API_PROXY, changeOrigin: true, secure: true } }
      : undefined,
  },
});
