import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import i18nInstance from './src/lib/i18n';
import { dirFor } from './src/lib/language';
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
import MessagesScreen from './src/screens/MessagesScreen';
import BookingScreen from './src/screens/BookingScreen';
import SideMenu from './src/components/SideMenu';
import SwipeBack from './src/components/SwipeBack';
import { canSwipeBack } from './src/lib/swipeBack';

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
  Messages: MessagesScreen, // two-way chat with the clinic (opened from Home)
  Booking: BookingScreen, // book a consultation (opened from the side menu)
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
          <Text style={{ fontSize: 16, color: '#C9897A', marginBottom: 12, fontWeight: '600' }}>{i18nInstance.t('onboarding:errorBoundary.title')}</Text>
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

  // Whether the side menu is open. The menu itself lives here (not in each screen) so that
  // one instance serves Home, Messages, Settings and Profile.
  const [menuOpen, setMenuOpen] = useState(false);
  // Stable function on purpose: SideMenu's Android Back-button listener effect depends on
  // onClose, so a new function every render would re-register the listener each time.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  // Close the menu whenever the screen stack changes (menu navigation, log out's reset,
  // retake...), so the menu can never stay open over a different screen.
  useEffect(() => { setMenuOpen(false); }, [stack]);

  // Latest menuOpen for the Back listener below (registered once, so it cannot close over state).
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  // Goes back one screen only when allowed (root screens, Loading and Quiz: does nothing).
  // Used by BOTH the edge swipe and the Android Back listener so they follow the same rule.
  // useCallback with [] keeps it stable, so the mount-only listener below never re-registers.
  const popIfAllowed = useCallback(() => {
    setStack(previous => (canSwipeBack(previous) ? previous.slice(0, -1) : previous));
  }, []);
  // Android system Back (button and OS back gesture) goes back one screen, using the same rule
  // as the edge swipe.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle;
    let cancelled = false;
    const onBackButton = () => {
      // Menu open: SideMenu's own listener closes it. This listener is registered at mount while
      // SideMenu's is registered only when the menu opens, and Capacitor notifies listeners in
      // registration order, so ours runs first while menuOpen is still true (the ref says
      // "open") and we must not also pop a screen.
      if (menuOpenRef.current) return;
      popIfAllowed();
    };
    Promise.resolve(CapacitorApp.addListener('backButton', onBackButton)).then(h => {
      if (cancelled) h?.remove?.();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, []);

  const navigation = {
    // Screens call this from their menu (hamburger) button.
    openMenu: () => setMenuOpen(true),
    navigate: (name, params = {}) => setStack(previous => [...previous, { name, params }]),
    replace: (name, params = {}) => setStack(previous => [...previous.slice(0, -1), { name, params }]),
    goBack: () => setStack(previous => previous.length > 1 ? previous.slice(0, -1) : previous),
    canGoBack: () => stack.length > 1,
    reset: ({ index = 0, routes = [] }) => {
      const next = routes.slice(0, index + 1);
      setStack(next.length ? next.map(route => ({ name: route.name, params: route.params || {} })) : [{ name: 'Splash', params: {} }]);
    },
  };

  // Changes on every navigation; also tells SwipeBack when the screen changed.
  const routeKey = `${current.name}-${stack.length}`;

  return (
    <>
      <SwipeBack enabled={canSwipeBack(stack)} onBack={popIfAllowed} screenKey={routeKey}>
        <Screen navigation={navigation} route={{ key: routeKey, name: current.name, params: current.params }} />
      </SwipeBack>
      <SideMenu visible={menuOpen} onClose={closeMenu} navigation={navigation} currentScreen={current.name} />
    </>
  );
}

// Sets the reading direction for everything inside it. react-native-web flips the logical style
// props (marginStart, paddingEnd, start...) from the nearest `dir`, so Hebrew mirrors the layout.
// useTranslation re-renders this when the language changes. flex:1 keeps it layout-neutral: it
// just fills #root like the screens did before. Anything rendered next to the navigator later
// (e.g. the side menu) must live inside this wrapper.
function DirectionRoot({ children }) {
  const { i18n } = useTranslation();
  return <View dir={dirFor(i18n.language)} style={{ flex: 1 }}>{children}</View>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AppProvider>
          <DirectionRoot>
            <AppNavigator />
          </DirectionRoot>
        </AppProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
