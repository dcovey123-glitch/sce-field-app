import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  assetsInclude: ['**/*.docx'],
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 3000, // desktop app loads from disk — big files are fine
    assetsInlineLimit: 200000, // inline images/template as base64 — avoids fetch() on file:// in the packaged app
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  }
})
