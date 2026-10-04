/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { designTokens } from './design-tokens.ts'

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [
    react(),
    designTokens(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/workers',
      filename: 'service-worker.ts',
      injectRegister: 'auto',
      registerType: 'autoUpdate',
      manifest: {
        name: 'CareDose - Medicine Monitoring',
        short_name: 'CareDose',
        description: 'Monitor medicine schedules, doses and dispenser devices for the people you care for.',
        start_url: '/dashboard',
        scope: '/',
        display: 'standalone',
        background_color: '#F9F7F7',
        theme_color: '#112D4E',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
    }),
  ],
  server: {
    proxy: { '/api': { target: API_TARGET, ws: true, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: API_TARGET, ws: true, changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'design-tokens.test.ts'],
    css: false,
    testTimeout: 15_000,
  },
})
