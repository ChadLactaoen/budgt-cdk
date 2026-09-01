import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  // Vite exposes .env values on import.meta.env, never on process.env, and this file
  // runs before that injection. Without loading them explicitly, VITE_API_PROXY in
  // .env.local is silently ignored: no proxy is installed, and every /api call falls
  // through to the SPA fallback as a 200 of index.html rather than reaching the API.
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const apiProxy = env.VITE_API_PROXY || process.env.VITE_API_PROXY;

  return {
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
      proxy: apiProxy
        ? { '/api': { target: apiProxy, changeOrigin: true, secure: true } }
        : undefined,
    },
  };
});
