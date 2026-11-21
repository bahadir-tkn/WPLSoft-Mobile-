import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'WPLSoft Web — Delta DVP PLC',
          short_name: 'WPLSoft',
          description:
            'Delta DVP Serisi PLC Ladder diyagram editörü, PC WPLSoft uyumlu IL dönüştürücüsü ve gerçek zamanlı 20ms tarama simülatörü.',
          theme_color: '#0B4EA2',
          background_color: '#ECEEF2',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
          suppressWarnings: true,
        },
      }),
      // Prevents vite-plugin-pwa@2.0.0 from calling import.meta.hot.send() before
      // Vite 8's HMR WebSocket connects (or when DISABLE_HMR=true), which otherwise
      // throws SendBeforeConnectError in dev/preview environments.
      {
        name: 'fix-vite8-pwa-dev-sw-hmr',
        apply: 'serve',
        enforce: 'post',
        transform(code: string, id: string) {
          if (!id.includes('vite-plugin-pwa/pwa-entry-point-loaded')) {
            return null;
          }
          const hmrDisabled = process.env.DISABLE_HMR === 'true';
          if (hmrDisabled) {
            return `
function registerDevSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/dev-sw.js?dev-sw', { scope: '/', type: 'module' })
      .catch(() => {});
  }
}
export default registerDevSW;
`;
          }
          return code.replace(
            /function registerDevSW\(\)\s*\{[\s\S]*?export default registerDevSW;/,
            `function registerDevSW() {
  if (!import.meta.hot) return;
  import.meta.hot.on('vite:ws:connect', () => {
    try {
      import.meta.hot?.send('vite-plugin-pwa:ready');
    } catch {
      // Ignore transient HMR socket state during dev reload
    }
  });
}
export default registerDevSW;`
          );
        },
      },
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: ['es2020', 'safari15'],
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/lucide-react/')) {
              return 'vendor-icons';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
