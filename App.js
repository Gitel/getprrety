import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableScreens } from 'react-native-screens';
import { useFonts } from 'expo-font';
import { CormorantGaramond_400Regular, CormorantGaramond_500Medium, CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { AppProvider } from './src/context/AppContext';
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

enableScreens();
const Stack = createNativeStackNavigator();

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
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

export default function App() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FAF8F5', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#C4957A" size="large" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AppProvider>
          <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#FAF8F5' } }}>
            <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }} initialRouteName="QuizIntro">
              <Stack.Screen name="Splash" component={SplashScreen} />
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="QuizIntro" component={QuizIntroScreen} />
              <Stack.Screen name="Quiz" component={QuizScreen} />
              <Stack.Screen name="Loading" component={LoadingScreen} />
              <Stack.Screen name="Profile" component={ProfileScreen} />
              <Stack.Screen name="SignUp" component={SignUpScreen} />
              <Stack.Screen name="SkinTiming" component={SkinTimingScreen} />
              <Stack.Screen name="SkinSelfie" component={SkinSelfieScreen} />
              <Stack.Screen name="ShelfPhotos" component={ShelfPhotosScreen} />
              <Stack.Screen name="Notifications" component={NotificationSetupScreen} />
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="ProductCamera" component={ProductCameraScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </AppProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
