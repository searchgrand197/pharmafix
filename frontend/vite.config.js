import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const rootDir = fileURLToPath(new URL('.', import.meta.url))

/** Prefer installed package; fall back to local shim when node_modules is incomplete. */
function resolvePackageOrShim(packageName, shimRelativePath) {
  try {
    require.resolve(packageName, { paths: [rootDir] })
    return packageName
  } catch {
    const shimPath = join(rootDir, shimRelativePath)
    if (existsSync(shimPath)) return shimPath
    return packageName
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@admin': fileURLToPath(new URL('./src/adminPortal', import.meta.url)),
      'react-hot-toast': resolvePackageOrShim(
        'react-hot-toast',
        'src/shims/reactHotToast.jsx',
      ),
      'lucide-react': resolvePackageOrShim(
        'lucide-react',
        'src/shims/lucideReact.jsx',
      ),
    },
  },
  build: {
    // Large portal bundles are expected; this is only a reporter warning.
    chunkSizeWarningLimit: 2500,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/jobs': 'http://127.0.0.1:8000',
      '/template': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@mui/material',
      '@mui/icons-material',
      '@tanstack/react-query',
      'lucide-react',
      'react-hot-toast',
    ],
  },
})
