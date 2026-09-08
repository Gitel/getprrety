import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/context/AppContext';
import WelcomeScreen from './src/screens/WelcomeScreen';
import SplashScreen from './src/screens/SplashScreen';
import QuizScreen from './src/screens/QuizScreen';
import LoadingScreen from './src/screens/LoadingScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import SkinTimingScreen from './src/screens/SkinTimingScreen';
import SkinSelfieScreen from './src/screens/SkinSelfieScreen';
import NotificationSetupScreen from './src/screens/NotificationSetupScreen';
import LoginScreen from './src/screens/LoginScreen';
import QuizIntroScreen from './src/screens/QuizIntroScreen';
import ShelfPhotosScreen from './src/screens/ShelfPhotosScreen';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProductCameraScreen from './src/screens/ProductCameraScreen';

const screens = {
  Welcome: WelcomeScreen,
  Splash: SplashScreen,
  Login: LoginScreen,
  QuizIntro: QuizIntroScreen,
  Quiz: QuizScreen,
  Loading: LoadingScreen,
  Profile: ProfileScreen,
  SignUp: SignUpScreen,
  SkinTiming: SkinTimingScreen,
  SkinSelfie: SkinSelfieScreen,
  ShelfPhotos: ShelfPhotosScreen,
  Notifications: NotificationSetupScreen,
  Home: HomeScreen,
  Settings: SettingsScreen,
  ProductCamera: ProductCameraScreen,
};

class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FAF8F5' }}>
          <Text style={{ fontSize: 16, color: '#C9897A', marginBottom: 12, fontWeight: '600' }}>Something went wrong</Text>
          <Text style={{ fontSize: 12, color: '#9B8E85', textAlign: 'center' }}>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// Capacitor renders a web app. This stack preserves the screen contract used by
// the existing UI without relying on React Native navigation modules.
function AppNavigator() {
  const [stack, setStack] = useState([{ name: 'Splash', params: {} }]);
  const current = stack[stack.length - 1];
  const Screen = screens[current.name] || SplashScreen;

  const navigation = {
    navigate: (name, params = {}) => setStack(previous => [...previous, { name, params }]),
    replace: (name, params = {}) => setStack(previous => [...previous.slice(0, -1), { name, params }]),
    goBack: () => setStack(previous => previous.length > 1 ? previous.slice(0, -1) : previous),
    canGoBack: () => stack.length > 1,
    reset: ({ index = 0, routes = [] }) => {
      const next = routes.slice(0, index + 1);
      setStack(next.length ? next.map(route => ({ name: route.name, params: route.params || {} })) : [{ name: 'Splash', params: {} }]);
    },
  };

  return <Screen navigation={navigation} route={{ key: `${current.name}-${stack.length}`, name: current.name, params: current.params }} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AppProvider>
          <AppNavigator />
        </AppProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
