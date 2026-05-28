import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isElectronBuild = process.env.BUILD_TARGET === 'electron'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  // In Electron production builds, use relative paths
  base: isElectronBuild ? './' : '/',

  define: {
    // Inject app version into renderer
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
  },

  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8100',
      '/ws': { target: 'ws://127.0.0.1:8100', ws: true },
      '/health': 'http://127.0.0.1:8100',
    },
  },

  build: {
    outDir: 'dist',
    // Ensure assets use relative paths for file:// protocol in Electron
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'vendor'
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons'
          }
        },
      },
    },
  },
})
