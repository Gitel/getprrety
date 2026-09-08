/// <reference types="@capacitor/local-notifications" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.getprrety.app',
  appName: 'Get Pretty',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    Camera: {
      promptLabelHeader: 'Get Pretty needs a photo',
      promptLabelPhoto: 'Choose from photos',
      promptLabelPicture: 'Take a photo',
    },
    LocalNotifications: {
      presentationOptions: ['sound', 'banner', 'list'],
    },
  },
};

export default config;
