import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { isRTL } from '../lib/language';
import { menuAction } from '../lib/sideMenu';
import { fetchBookingConfig } from '../lib/bookingApi';
import { openLegal, TERMS_URL, PRIVACY_URL } from '../lib/consent';
import { startRetake } from '../lib/retake';
import { logActivity } from '../lib/logActivity';
import { saveLanguage } from '../lib/languageSync';
import { rescheduleReminders } from '../lib/notifications';
import { eraText } from '../lib/eraText';
import { quizEntryScreen } from '../lib/welcomeVariants';

// The last booking answer this app session got ('on' or 'off'), or null before any answer.
// Module-level (not state/ref) on purpose: it must survive the menu closing and be shared by every
// screen's SideMenu, and it lives in memory only, so a reload starts with no answer again.
// Later openings start from it (no blank placeholder, rows do not move) while the config is
// re-fetched in the background.
let lastBookingAnswer = null;

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

// The two languages the switch offers. Each option is drawn in ITS OWN language (English shows
// "English", Hebrew shows its own name), whatever language the UI is in now. getFixedT(lang)
// reads the `languageName` key of that language file, so no Hebrew text is needed in this file.
const LANGUAGES = ['en', 'he'];

// The language row at the bottom of the menu: a label plus one button per language.
//   current  the UI language now ('en' or 'he'); that option is shown as selected
//   onPick   called with the language the user tapped (never with the current one)
function LanguageRow({ current, onPick }) {
  const { t, i18n } = useTranslation();
  return (
    <View style={s.langRow}>
      <Text style={s.langLabel}>{t('menu:language')}</Text>
      {LANGUAGES.map(lang => {
        const selected = lang === current;
        const name = i18n.getFixedT(lang)('menu:languageName');
        return (
          <Pressable
            key={lang}
            // Tapping the language already in use does nothing.
            onPress={selected ? undefined : () => onPick(lang)}
            style={s.langOption}
            accessibilityRole="button"
            accessibilityLabel={name}
            // react-native-web passes aria-* props through to the DOM.
            aria-pressed={selected}
          >
            <Text style={[s.langText, selected && s.langTextSelected]}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
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
  // Answer of THIS opening: null until it arrives, then 'on' (row shown) or 'off' (nothing; the
  // server says disabled, or the request failed).
  const [openingAnswer, setOpeningAnswer] = useState(null);
  // What the booking row shows: this opening's answer, else the last known answer, else
  // 'loading' (only the very first opening: an empty placeholder keeps the row's space).
  const bookingState = openingAnswer ?? lastBookingAnswer ?? 'loading';
  // Horizontal offset of the panel. It starts OFF-screen (-320 = left in English, +320 = right
  // in Hebrew) and is put back off-screen every time the menu closes (effect below), so the
  // first painted frame of an opening menu is never the fully-open panel.
  const slide = useRef(new Animated.Value(rtl ? 320 : -320)).current;

  // Forget the inline confirm whenever the menu closes.
  useEffect(() => {
    if (!visible) setConfirmRetake(false);
  }, [visible]);

  // Ask the server on every opening whether booking is on; the "Book" row shows only if so.
  // While closed we forget this opening's answer, so the next opening starts from the last known
  // answer (or the placeholder on the first one). `cancelled` ignores a late answer from an
  // earlier opening (the cleanup runs when the menu closes or reopens), so it is never stored.
  useEffect(() => {
    if (!visible) {
      setOpeningAnswer(null);
      return undefined;
    }
    let cancelled = false;
    const answer = value => {
      if (cancelled) return;
      lastBookingAnswer = value;
      setOpeningAnswer(value);
    };
    fetchBookingConfig()
      .then(config => answer(config?.enabled === true ? 'on' : 'off'))
      .catch(() => answer('off'));
    return () => { cancelled = true; };
  }, [visible]);

  // Slide the panel in when it opens. translateX is NOT mirrored by react-native-web, so we
  // start from -width (left) in English and +width (right) in Hebrew. The panel is at most
  // 320 wide, so 320 is always enough to start fully off-screen.
  // useLayoutEffect (not useEffect) runs before the browser paints, so the start position is
  // in place before the first frame is drawn.
  useLayoutEffect(() => {
    if (!visible) {
      // Closed: park the panel off-screen on the correct side for the next opening.
      slide.setValue(rtl ? 320 : -320);
      return;
    }
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

  function handleRetake() {
    onClose();
    startRetake({ navigation, user, setAnalysis, setAnswers });
  }

  // Switches the app language. saveLanguage changes the UI at once (the menu re-renders in the
  // new direction and stays open), stores the choice on the device and sends it to the account
  // in the background. rescheduleReminders re-creates the local reminders so their text follows
  // the new language. Both never throw. We do not call setUser: the account copy is refreshed on
  // the next resume, and a new user object would re-run Profile's paid product-picks effect.
  function handleLanguage(lang) {
    saveLanguage(lang).then(() => rescheduleReminders());
  }

  async function handleLogout() {
    onClose();
    await logActivity('logout');
    await logout();
    // Log out shows Login; the quiz landing sits beneath it so Back / swipe returns to it.
    navigation.reset({ index: 1, routes: [{ name: quizEntryScreen() }, { name: 'Login' }] });
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
                  {era ? <Text style={s.era}>{era.emoji} {eraText(era, 'name', i18n.language)}</Text> : null}
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
              {bookingState === 'on' ? (
                <Item icon={'\uD83D\uDCC5'} label={t('menu:book')} current={currentScreen === 'Booking'}
                  onPress={() => go('Booking')} />
              ) : null}
              {bookingState === 'loading' ? (
                // Empty row built like Item (non-breaking spaces), so it has the same height and
                // the rows below do not move when the real row appears.
                <View testID="menu-book-placeholder" style={s.item} aria-hidden>
                  <Text style={s.itemIcon}>{'\u00A0'}</Text>
                  <Text style={s.itemText}>{'\u00A0'}</Text>
                </View>
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

              <View style={s.divider} />

              <LanguageRow current={i18n.language} onPick={handleLanguage} />
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
  confirm: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginVertical: 6 },
  confirmText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text, textAlign: 'start' },
  confirmRow: { flexDirection: 'row', marginTop: 12 },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', marginEnd: 8 },
  confirmBtnPrimary: { backgroundColor: C.accent, borderColor: C.accent, marginEnd: 0 },
  confirmBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text },
  confirmBtnPrimaryText: { color: '#fff' },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  langLabel: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'start' },
  langOption: { paddingVertical: 6, paddingHorizontal: 10, marginStart: 4 },
  langText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.text },
  langTextSelected: { color: C.accent, fontFamily: 'DMSans_700Bold', fontWeight: '700' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
});
