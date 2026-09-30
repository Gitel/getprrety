import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { isRTL } from '../lib/language';
import { menuAction } from '../lib/sideMenu';
import { BOOKING_READY, BOOKING_URL } from '../lib/booking';
import { openInAppBrowser } from '../lib/inAppBrowser';
import { openLegal, TERMS_URL, PRIVACY_URL } from '../lib/consent';
import { startRetake } from '../lib/retake';
import { logActivity } from '../lib/logActivity';

// Slide-in length in milliseconds.
const SLIDE_MS = 200;

// True when the user asked the OS for less motion (copy of the check in ScoreSection.jsx).
function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// The hamburger button screens put in their header to open the menu.
export function MenuButton({ onPress, color }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('menu:open')}
    >
      <Text style={[s.hamburger, color ? { color } : null]}>{'\u2630'}</Text>
    </Pressable>
  );
}

// One row of the menu. `current` marks the screen the user is on.
function Item({ icon, label, onPress, current, role = 'button', a11yLabel, badge }) {
  return (
    <Pressable
      onPress={onPress}
      style={s.item}
      accessibilityRole={role}
      accessibilityLabel={a11yLabel || label}
      // aria-current is passed through by react-native-web to the DOM.
      aria-current={current ? 'page' : undefined}
    >
      {icon ? <Text style={s.itemIcon}>{icon}</Text> : null}
      <Text style={[s.itemText, current && s.itemTextCurrent]}>{label}</Text>
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// The slide-in navigation menu. Screens render it with their own `visible` state.
//   visible       true while the menu is open
//   onClose       called to close it
//   navigation    the root navigation object from App.jsx
//   currentScreen name of the screen showing the menu (used to skip/replace/back correctly)
export default function SideMenu({ visible, onClose, navigation, currentScreen }) {
  const { t, i18n } = useTranslation();
  const { analysis, user, unreadMessages, setAnalysis, setAnswers, logout } = useApp();
  const rtl = isRTL(i18n.language);

  const [confirmRetake, setConfirmRetake] = useState(false);
  const [bookingFailed, setBookingFailed] = useState(false);
  // Off-screen start position of the panel; set by the slide effect below.
  const slide = useRef(new Animated.Value(0)).current;

  // Forget the inline confirm and the booking error whenever the menu closes.
  useEffect(() => {
    if (!visible) {
      setConfirmRetake(false);
      setBookingFailed(false);
    }
  }, [visible]);

  // Slide the panel in when it opens. translateX is NOT mirrored by react-native-web, so we
  // start from -width (left) in English and +width (right) in Hebrew. The panel is at most
  // 320 wide, so 320 is always enough to start fully off-screen.
  useEffect(() => {
    if (!visible) return;
    if (prefersReducedMotion()) {
      slide.setValue(0);
      return;
    }
    slide.setValue(rtl ? 320 : -320);
    Animated.timing(slide, { toValue: 0, duration: SLIDE_MS, useNativeDriver: false }).start();
  }, [visible, rtl, slide]);

  // Android hardware Back closes the menu while it is open. The listener exists only while
  // visible, so Back behaves as before everywhere else.
  useEffect(() => {
    if (!visible || !Capacitor.isNativePlatform()) return undefined;
    let handle;
    let cancelled = false;
    Promise.resolve(CapacitorApp.addListener('backButton', onClose)).then(h => {
      if (cancelled) h?.remove?.();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [visible, onClose]);

  // Navigates to a menu screen following menuAction (see src/lib/sideMenu.js).
  function go(target, params) {
    const action = menuAction(currentScreen, target);
    onClose();
    if (action === 'back') navigation.goBack();
    else if (action === 'navigate') navigation.navigate(target, params);
    else if (action === 'replace') navigation.replace(target, params);
    // 'close': the user is already on that screen, closing the menu is enough.
  }

  // Must call openInAppBrowser synchronously in the tap (before any await), see inAppBrowser.js.
  function handleBook() {
    setBookingFailed(false);
    openInAppBrowser(BOOKING_URL).then(opened => {
      if (opened) onClose();
      else setBookingFailed(true);
    });
  }

  function handleRetake() {
    onClose();
    startRetake({ navigation, user, setAnalysis, setAnswers });
  }

  async function handleLogout() {
    onClose();
    await logActivity('logout');
    await logout();
    navigation.reset({ index: 0, routes: [{ name: 'Splash' }] });
  }

  const era = analysis?.era;
  const name = (user?.firstName || '').trim();
  // U+2068/U+2069 isolate the name so an English name inside Hebrew text keeps its own direction.
  const greeting = name
    ? t('menu:greeting', { name: `\u2068${name}\u2069` })
    : t('menu:greetingNoName');
  const unread = unreadMessages > 9 ? '9+' : unreadMessages > 0 ? String(unreadMessages) : null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      {/* A row mirrors in RTL by itself: the panel is first, so it sits on the start side. */}
      <View style={s.root}>
        <Animated.View style={[s.panelWrap, { transform: [{ translateX: slide }] }]}>
          <SafeAreaView style={s.panel} accessibilityLabel={t('menu:panel')}>
            <ScrollView contentContainerStyle={s.panelContent}>
              <View style={s.header}>
                <View style={s.headerText}>
                  <Text style={s.brand}>Get Pretty</Text>
                  <Text style={s.greeting}>{greeting}</Text>
                  {era ? <Text style={s.era}>{era.emoji} {era.name}</Text> : null}
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('menu:close')}
                >
                  <Text style={s.closeX}>{'\u2715'}</Text>
                </Pressable>
              </View>

              <Item icon={'\uD83C\uDF3F'} label={t('menu:myRoutine')} current={currentScreen === 'Home'}
                onPress={() => go('Home')} />
              {analysis ? (
                <Item icon={'\u2728'} label={t('menu:mySkinProfile')} current={currentScreen === 'Profile'}
                  onPress={() => go('Profile', { fromHome: true })} />
              ) : null}
              <Item
                icon={'\uD83D\uDCAC'}
                label={t('menu:messages')}
                a11yLabel={unread ? t('menu:messagesUnread', { count: unreadMessages }) : undefined}
                badge={unread}
                current={currentScreen === 'Messages'}
                onPress={() => go('Messages')}
              />
              {BOOKING_READY ? (
                <>
                  <Item icon={'\uD83D\uDCC5'} label={t('menu:book')} onPress={handleBook} />
                  {bookingFailed ? <Text style={s.error}>{t('menu:bookingError')}</Text> : null}
                </>
              ) : null}
              <Item icon={'\uD83E\uDDF4'} label={t('menu:logProducts')} current={currentScreen === 'ProductCamera'}
                onPress={() => go('ProductCamera')} />
              <Item icon={'\u2699\uFE0F'} label={t('menu:settings')} current={currentScreen === 'Settings'}
                onPress={() => go('Settings')} />

              {confirmRetake ? (
                <View style={s.confirm}>
                  <Text style={s.confirmText}>{t('menu:retakeConfirm')}</Text>
                  <View style={s.confirmRow}>
                    <Pressable style={s.confirmBtn} onPress={() => setConfirmRetake(false)}
                      accessibilityRole="button">
                      <Text style={s.confirmBtnText}>{t('common:cancel')}</Text>
                    </Pressable>
                    <Pressable style={[s.confirmBtn, s.confirmBtnPrimary]} onPress={handleRetake}
                      accessibilityRole="button">
                      <Text style={[s.confirmBtnText, s.confirmBtnPrimaryText]}>{t('menu:retakeYes')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Item icon={'\uD83D\uDD04'} label={t('menu:retake')} onPress={() => setConfirmRetake(true)} />
              )}

              <View style={s.divider} />

              <Item label={t('menu:terms')} role="link" onPress={() => openLegal(TERMS_URL)} />
              <Item label={t('menu:privacy')} role="link" onPress={() => openLegal(PRIVACY_URL)} />

              <View style={s.divider} />

              <Item icon={'\uD83D\uDEAA'} label={t('menu:logout')} onPress={handleLogout} />
            </ScrollView>
          </SafeAreaView>
        </Animated.View>

        {/* Tapping the dimmed area closes the menu. */}
        <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button"
          accessibilityLabel={t('menu:close')} />
      </View>
    </Modal>
  );
}

// Only logical props (marginStart/End, paddingStart/End, textAlign 'start'): they flip in RTL.
const s = StyleSheet.create({
  hamburger: { fontSize: 24, color: C.text },
  root: { flex: 1, flexDirection: 'row' },
  panelWrap: { width: '82%', maxWidth: 320 },
  panel: { flex: 1, backgroundColor: C.bg },
  panelContent: { paddingHorizontal: 20, paddingVertical: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  headerText: { flex: 1, marginEnd: 12 },
  brand: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 24, color: C.text, textAlign: 'start' },
  greeting: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.text, marginTop: 6, textAlign: 'start' },
  era: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, marginTop: 2, textAlign: 'start' },
  closeX: { fontSize: 20, color: C.muted },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  itemIcon: { fontSize: 18, marginEnd: 12, width: 26 },
  itemText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 16, color: C.text, textAlign: 'start' },
  itemTextCurrent: { color: C.accent, fontFamily: 'DMSans_700Bold', fontWeight: '700' },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginStart: 8,
  },
  badgeText: { fontFamily: 'DMSans_700Bold', fontSize: 11, color: '#fff' },
  error: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#B3402A', paddingStart: 38, paddingBottom: 8, textAlign: 'start' },
  confirm: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginVertical: 6 },
  confirmText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text, textAlign: 'start' },
  confirmRow: { flexDirection: 'row', marginTop: 12 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', marginEnd: 8 },
  confirmBtnPrimary: { backgroundColor: C.accent, borderColor: C.accent, marginEnd: 0 },
  confirmBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text },
  confirmBtnPrimaryText: { color: '#fff' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
});
