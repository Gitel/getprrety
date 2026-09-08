import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

function definePublicValue(value) {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

export default defineConfig(({ mode }) => {
  const publicEnv = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react()],
    resolve: {
      alias: [
        { find: 'react-native-safe-area-context', replacement: fileURLToPath(new URL('./src/capacitor/SafeAreaContext.jsx', import.meta.url)) },
        { find: 'react-native', replacement: 'react-native-web' },
      ],
      extensions: ['.web.mjs', '.web.js', '.web.mts', '.web.ts', '.web.jsx', '.web.tsx', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    },
    // Legacy web modules read process.env.VITE_*. Inline their public values now so
    // Vite does not emit import.meta.env into the browser bundle at runtime.
    define: {
      // React Native Web's animation code uses Node's global name for animation frames.
      // Browsers expose the equivalent object as globalThis, so replace it at build time.
      global: 'globalThis',
      'process.env.VITE_API_URL': definePublicValue(publicEnv.VITE_API_URL),
      'process.env.VITE_TERMS_URL': definePublicValue(publicEnv.VITE_TERMS_URL),
      'process.env.VITE_PRIVACY_URL': definePublicValue(publicEnv.VITE_PRIVACY_URL),
      'process.env.VITE_CONSENT_VERSION': definePublicValue(publicEnv.VITE_CONSENT_VERSION),
      'process.env.VITE_GOOGLE_WEB_CLIENT_ID': definePublicValue(publicEnv.VITE_GOOGLE_WEB_CLIENT_ID),
    },
  }
})
