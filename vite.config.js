import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'react-native-safe-area-context', replacement: fileURLToPath(new URL('./src/capacitor/SafeAreaContext.jsx', import.meta.url)) },
      { find: 'react-native', replacement: 'react-native-web' },
    ],
    extensions: ['.web.mjs', '.web.js', '.web.mts', '.web.ts', '.web.jsx', '.web.tsx', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
  },
  define: {
    'process.env.VITE_API_URL': 'import.meta.env.VITE_API_URL',
    'process.env.VITE_TERMS_URL': 'import.meta.env.VITE_TERMS_URL',
    'process.env.VITE_PRIVACY_URL': 'import.meta.env.VITE_PRIVACY_URL',
    'process.env.VITE_CONSENT_VERSION': 'import.meta.env.VITE_CONSENT_VERSION',
    'process.env.VITE_GOOGLE_WEB_CLIENT_ID': 'import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID',
  },
})
