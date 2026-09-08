import React from 'react';
import { View } from 'react-native';

// Capacitor owns the native shell; on the web, CSS env() applies the device insets.
export function SafeAreaProvider({ children }) {
  return <>{children}</>;
}

export function SafeAreaView({ style, children, ...props }) {
  return (
    <View
      {...props}
      style={[{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }, style]}
    >
      {children}
    </View>
  );
}
