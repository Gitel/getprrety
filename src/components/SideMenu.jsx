import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { menuAction } from '../lib/sideMenu';
import { BOOKING_READY, BOOKING_URL } from '../lib/booking';
import { openInAppBrowser } from '../lib/inAppBrowser';
import { openLegal, TERMS_URL, PRIVACY_URL } from '../lib/consent';
import { startRetake } from '../lib/retake';
import { logActivity } from '../lib/logActivity';
import { saveLanguage } from '../lib/languageSync';
import { rescheduleReminders } from '../lib/notifications';
import { eraText } from '../lib/eraText';
import { quizEntryScreen } from '../lib/welcomeVariants';
import { OPEN_MS, CLOSE_MS, EMPTY_POLYGON, easeOpen, easeClose, liquidClipPath } from '../lib/liquidReveal';

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

// The menu content (header, items, confirm box, legal links, logout, language row).
// It is wrapped in React.memo because the menu is now ALWAYS mounted (hidden while closed) so that
// opening it is instant. Without memo, every re-render of SideMenu (App re-renders it on every
// navigation change and passes a brand new `navigation` object each time) would rebuild all
// these rows. The props are deliberately stable:
//   currentScreen  name of the screen showing the menu
//   onClose        stable callback from App.jsx
//   navigationRef  a ref (its identity never changes) holding the latest `navigation`; handlers
//                  read navigationRef.current when the user taps, so they never use a stale object
//   closedCount    bumps each time a close animation finishes; used to reset the local UI state
//   scrollRef      a ref (stable identity) to the ScrollView; SideMenu resets its scroll on close
// `visible` is NOT a prop on purpose: opening/closing the menu must not re-render the body.
const MenuBody = memo(function MenuBody({ currentScreen, onClose, navigationRef, closedCount, scrollRef }) {
  const { t, i18n } = useTranslation();
  const { analysis, user, unreadMessages, setAnalysis, setAnswers, logout } = useApp();

  const [confirmRetake, setConfirmRetake] = useState(false);
  const [bookingFailed, setBookingFailed] = useState(false);

  // Forget the inline confirm and the booking error each time the menu has finished closing.
  // (The scroll position is reset by SideMenu when the close ends, before display:none is applied:
  // an element hidden with display:none has no box, so scrolling it here would do nothing.)
  useEffect(() => {
    setConfirmRetake(false);
    setBookingFailed(false);
  }, [closedCount]);

  // Navigates to a menu screen following menuAction (see src/lib/sideMenu.js).
  function go(target, params) {
    const action = menuAction(currentScreen, target);
    onClose();
    if (action === 'back') navigationRef.current.goBack();
    else if (action === 'navigate') navigationRef.current.navigate(target, params);
    else if (action === 'replace') navigationRef.current.replace(target, params);
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
    startRetake({ navigation: navigationRef.current, user, setAnalysis, setAnswers });
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
    navigationRef.current.reset({ index: 1, routes: [{ name: quizEntryScreen() }, { name: 'Login' }] });
  }

  const era = analysis?.era;
  const name = (user?.firstName || '').trim();
  // U+2068/U+2069 isolate the name so an English name inside Hebrew text keeps its own direction.
  const greeting = name
    ? t('menu:greeting', { name: `\u2068${name}\u2069` })
    : t('menu:greetingNoName');
  const unread = unreadMessages > 9 ? '9+' : unreadMessages > 0 ? String(unreadMessages) : null;

  return (
    <SafeAreaView style={s.panel} accessibilityLabel={t('menu:panel')}>
      <ScrollView ref={scrollRef} contentContainerStyle={s.panelContent}>
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

        <View style={s.divider} />

        <LanguageRow current={i18n.language} onPick={handleLanguage} />
      </ScrollView>
    </SafeAreaView>
  );
});

// Soft edge shadow: thin translucent bands that follow the wave (no blur, which is slow on phones).
// Each band is the liquid shape pushed forward by its offset (px); tune the colour/offsets here.
const SHADOW_OFFSETS = [4, 9, 14];
const SHADOW_COLOR = 'rgba(0,0,0,0.06)';

// Keyboard-focusable elements inside the panel (used by the focus trap).
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

// The navigation menu. App.jsx renders it once, with its own `visible` state.
//   visible       true while the menu is open
//   onClose       called to close it
//   navigation    the root navigation object from App.jsx
//   currentScreen name of the screen showing the menu (used to skip/replace/back correctly)
//
// The overlay has four states:
//   closed   display:none. Unfocusable, hidden from screen readers, untappable.
//   opening  displayed; a liquid shape (CSS clip-path) grows from the menu-button corner.
//   open     fully revealed, page dimmed 20%, focus trapped in the panel.
//   closing  displayed but pointerEvents none, so the screen underneath is usable at once; the
//            shape flows back. When it ends the overlay goes back to `closed`.
export default function SideMenu({ visible, onClose, navigation, currentScreen }) {
  const { user } = useApp();
  const { t } = useTranslation();

  // `shown` = the overlay is displayed (opening, open or closing). It is NOT simply `visible`:
  // when `visible` turns false the overlay must stay displayed until the close animation ends.
  const [shown, setShown] = useState(visible);
  // Bumps each time a close finishes (MenuBody resets its local state when it changes).
  const [closedCount, setClosedCount] = useState(0);
  // "Adjust state while rendering": when the menu is asked to open, mark it shown in the SAME
  // render, so the commit that opens it already displays it.
  if (visible && !shown) setShown(true);

  const overlayRef = useRef(null);
  const dimRef = useRef(null);
  const revealRef = useRef(null);
  // One ref per shadow band; their clip-path is written to the DOM each frame like the reveal's.
  const shadowRefs = useRef([]);
  // The menu's ScrollView (owned here, passed to MenuBody) so the end of a close can reset its scroll.
  const scrollRef = useRef(null);
  // 0 = fully hidden .. 1 = fully open. A ref (not state): it changes every frame.
  const progressRef = useRef(visible ? 1 : 0);
  const rafRef = useRef(0);
  // True once the menu has been opened and not yet fully closed (so the first mount does nothing).
  const activeRef = useRef(visible);
  // Element that had focus before the menu opened (the hamburger), restored on close.
  const lastFocusRef = useRef(null);
  // Always the latest navigation object. App creates a new one on every render, so passing it as
  // a prop would re-render the memoized MenuBody every time; handlers read this ref when tapped.
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  // Drives the reveal. useLayoutEffect runs after the commit that displayed the overlay but
  // BEFORE the browser paints it, so the starting values are in place before the first frame.
  //
  // Why values are written straight to the DOM (node.style.clipPath / opacity) and not through
  // React style props: they change every frame; going through React would re-render per frame
  // and any unrelated re-render could overwrite them.
  //
  // Why the clock starts in the FIRST animation frame and not at the tap: on a slow phone,
  // building and showing the overlay can take a while; a clock started at the tap would have run
  // out before anything was visible and the menu would jump. That first callback counts as 16 ms.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const reveal = revealRef.current;
    const dim = dimRef.current;
    if (!overlay || !reveal || !dim) return undefined;
    if (!visible && !activeRef.current) return undefined; // first mount, still closed
    activeRef.current = visible;

    const target = visible ? 1 : 0;
    const p0 = progressRef.current;
    const width = reveal.offsetWidth;
    const height = reveal.offsetHeight;
    // Direction is read at the start of each animation (a language switch can change it).
    const rtl = getComputedStyle(overlay).direction === 'rtl';

    // Removes the inline values: no clip, dim at its full CSS value (darkness 0.2).
    const bands = shadowRefs.current.filter(Boolean);
    const clearInline = () => {
      reveal.style.clipPath = '';
      bands.forEach(b => { b.style.clipPath = ''; });
      dim.style.opacity = '';
    };
    // Writes the CLOSED look: empty clip on the reveal and every band, no dim.
    const writeClosedLook = () => {
      reveal.style.clipPath = EMPTY_POLYGON;
      bands.forEach(b => { b.style.clipPath = EMPTY_POLYGON; });
      dim.style.opacity = '0';
    };
    // End of a close: hide the overlay and tell MenuBody it can reset.
    // Called from an animation frame, a state update (setShown) is applied by React in a LATER
    // task, so the browser paints this frame first. If we cleared the inline values here the
    // overlay would flash fully open (no clip, full dim) for one frame. So the animated close
    // writes the closed look and the overlay stays invisible until display:none arrives.
    // Reduced motion runs in the layout effect (before paint, React re-renders synchronously),
    // so clearing is safe there. Every open path starts from or ends at a state it writes itself.
    const finishClose = (animated) => {
      if (animated) writeClosedLook();
      else clearInline();
      // Back to the top for the next open. Done here, while the overlay is still displayed and
      // invisible: once display:none is applied the element has no box and scrolling it does
      // nothing, and some engines (WebKit) restore the old offset when it is shown again.
      scrollRef.current?.scrollTo?.({ y: 0, animated: false });
      setShown(false);
      setClosedCount(n => n + 1);
    };

    // Reduced motion (or nothing measurable): jump straight to the end state.
    if (prefersReducedMotion() || !width || !height) {
      progressRef.current = target;
      if (target) clearInline();
      else finishClose(false);
      return undefined;
    }

    // Starting values, in place before the first paint of the newly displayed overlay.
    if (p0 === 0) writeClosedLook();

    // Duration is scaled by the distance left, so reversing mid-way continues smoothly.
    const duration = (target ? OPEN_MS : CLOSE_MS) * Math.abs(target - p0);
    const ease = target ? easeOpen : easeClose;
    let startTs = null;

    const frame = ts => {
      if (startTs === null) startTs = ts - 16;
      const tau = duration > 0 ? (ts - startTs) / duration : 1;
      const p = tau >= 1 ? target : p0 + (target - p0) * ease(tau);
      progressRef.current = p;
      if (p === target) {
        rafRef.current = 0;
        if (target) clearInline();
        else finishClose(true);
        return;
      }
      const clip = liquidClipPath({ width, height, progress: p, timeMs: ts, rtl });
      reveal.style.clipPath = clip === 'none' ? '' : clip;
      // Each band is the same shape pushed forward, so it peeks out ahead of the panel edge.
      bands.forEach((b, i) => {
        b.style.clipPath = liquidClipPath({
          width, height, progress: p, timeMs: ts, rtl, offset: SHADOW_OFFSETS[i],
        });
      });
      dim.style.opacity = String(p);
      rafRef.current = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(frame);

    // New animation or unmount: stop the loop. progressRef keeps the current value.
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible]);

  // Focus handling (what the old Modal gave for free). While the menu is open:
  //   - focus moves into the panel (the X button) and the previous focus is remembered;
  //   - Tab / Shift+Tab wrap inside the panel; focus that escapes is pulled back in;
  //   - Escape closes. When it closes, focus returns to what had it (if it still exists).
  useEffect(() => {
    const overlay = overlayRef.current;
    const panelItems = () => Array.from(revealRef.current?.querySelectorAll(FOCUSABLE) || []);

    if (!visible) {
      const prev = lastFocusRef.current;
      lastFocusRef.current = null;
      // After picking an item the hamburger may be gone; then there is nothing to restore.
      if (prev && document.contains(prev)) prev.focus?.({ preventScroll: true });
      return undefined;
    }

    lastFocusRef.current = document.activeElement;
    panelItems()[0]?.focus({ preventScroll: true });

    const onKeyDown = e => {
      if (e.key !== 'Tab') return;
      const items = panelItems();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!overlay?.contains(active)) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const onFocusIn = e => {
      if (overlay && !overlay.contains(e.target)) panelItems()[0]?.focus({ preventScroll: true });
    };
    const onKeyUp = e => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [visible, onClose]);

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

  // Signed-out screens hold no menu at all; when signed in it stays mounted (hidden) so that
  // opening it is instant.
  if (!user && !shown && !visible) return null;

  const closing = shown && !visible;

  return (
    <View
      ref={overlayRef}
      testID="side-menu"
      role="dialog"
      // While closing, focus is already back on the page, so it is no longer modal.
      aria-modal={!closing}
      style={[s.overlay, !shown && s.overlayClosed, closing && s.overlayClosing]}
    >
      {/* Dim layer. Its opacity is written to the DOM every frame (never a React style key). */}
      <View ref={dimRef} testID="side-menu-dim" style={s.dim} />

      {/* A row mirrors in RTL by itself: the panel is first, so it sits on the start side. */}
      <View style={s.row}>
        {/* The shadow bands sit under the reveal, so they show only where they stick out ahead of it. */}
        <View style={s.panelWrap}>
          {SHADOW_OFFSETS.map((_, i) => (
            <View
              key={i}
              ref={el => { shadowRefs.current[i] = el; }}
              aria-hidden={true}
              style={s.shadowBand}
            />
          ))}
          {/* clip-path is written to the DOM every frame (never a React style key). */}
          <View ref={revealRef} testID="side-menu-reveal" style={s.reveal}>
            <MenuBody
              currentScreen={currentScreen}
              onClose={onClose}
              navigationRef={navigationRef}
              closedCount={closedCount}
              scrollRef={scrollRef}
            />
          </View>
        </View>

        {/* Transparent strip beside the panel: tapping it closes the menu. Not in the Tab order. */}
        <Pressable style={s.backdrop} onPress={onClose} focusable={false} accessibilityRole="button"
          accessibilityLabel={t('menu:close')} />
      </View>
    </View>
  );
}

// Only logical props (marginStart/End, paddingStart/End, textAlign 'start'): they flip in RTL.
const s = StyleSheet.create({
  hamburger: { fontSize: 24, color: C.text },
  // Overlay root: covers the screen above everything. Closed = display none; closing = not tappable.
  overlay: { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000 },
  overlayClosed: { display: 'none' },
  overlayClosing: { pointerEvents: 'none' },
  // 20% black; its opacity (0..1) is animated through the DOM, so darkness = 0.2 x progress.
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)', pointerEvents: 'none' },
  row: { flex: 1, flexDirection: 'row' },
  panelWrap: { width: '82%', maxWidth: 320 },
  shadowBand: { ...StyleSheet.absoluteFillObject, backgroundColor: SHADOW_COLOR, pointerEvents: 'none' },
  reveal: { flex: 1 },
  panel: { flex: 1, backgroundColor: C.bg },
  panelContent: { paddingHorizontal: 20, paddingVertical: 16 },
  // Transparent: the dim layer provides the colour.
  backdrop: { flex: 1 },
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
  langRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  langLabel: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'start' },
  langOption: { paddingVertical: 6, paddingHorizontal: 10, marginStart: 4 },
  langText: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.text },
  langTextSelected: { color: C.accent, fontFamily: 'DMSans_700Bold', fontWeight: '700' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
});
