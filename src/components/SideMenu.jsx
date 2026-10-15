import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { menuAction } from '../lib/sideMenu';
import { fetchBookingConfig } from '../lib/bookingApi';
import { openLegal, TERMS_URL, PRIVACY_URL } from '../lib/consent';
import { startRetake } from '../lib/retake';
import { logActivity } from '../lib/logActivity';
import { saveLanguage } from '../lib/languageSync';
import { rescheduleReminders } from '../lib/notifications';
import { eraText } from '../lib/eraText';
import { quizEntryScreen } from '../lib/welcomeVariants';
import { isRTL } from '../lib/language';
import {
  OPEN_MS, CLOSE_MS, OPEN_SETTLE_MS, BLEND_MS, EDGE_INSET, STRIP_W, STRIP_OUT, VIEW_H,
  SHADOW_STEPS, SHADOW_STROKE_PX, ROW_SHIFT_PX, ROW_DURATION_MS,
  easeOpen, easeClose, openBulge, closeBulge, edgeFillPath, edgeShadowPaths,
  FLAT_FILL, FLAT_SHADOWS, rowDelays,
} from '../lib/elasticEdge';

// The last booking answer this app session got ('on' or 'off'), or null before any answer.
// Module-level (not state/ref) on purpose: it must survive the menu closing and be shared by every
// screen's SideMenu, and it lives in memory only, so a reload starts with no answer again.
// Later openings start from it (no blank placeholder, rows do not move) while the config is
// re-fetched in the background.
let lastBookingAnswer = null;

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
//   bookingState   'on' (show the Book row), 'off' (no row) or 'loading' (empty placeholder row).
//                  SideMenu fetches it on every opening; a plain string, so memo re-renders the
//                  body only when the answer actually changes.
// `visible` is NOT a prop on purpose: opening/closing the menu must not re-render the body.
const MenuBody = memo(function MenuBody({ currentScreen, onClose, navigationRef, closedCount, scrollRef, bookingState }) {
  const { t, i18n } = useTranslation();
  const { analysis, user, unreadMessages, setAnalysis, setAnswers, logout } = useApp();

  const [confirmRetake, setConfirmRetake] = useState(false);

  // Forget the inline confirm each time the menu has finished closing.
  // (The scroll position is reset by SideMenu when the close ends, before display:none is applied:
  // an element hidden with display:none has no box, so scrolling it here would do nothing.)
  useEffect(() => {
    setConfirmRetake(false);
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
        {/* One wrapper around every row: SideMenu finds it (by testID) and fades its direct
            children in one after another when the menu opens. */}
        <View testID="side-menu-rows">
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
        {/* Products the analysis recommends (needs an analysis, like the skin profile row). */}
        {analysis ? (
          <Item icon={'🧴'} label={t('menu:myProducts')} current={currentScreen === 'MyProducts'}
            onPress={() => go('MyProducts')} />
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
});

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
//   opening  displayed; the panel slides in from the screen edge (CSS transform) with an elastic
//            bulge on its trailing edge, and the rows fade in one after another.
//   open     fully slid in, page dimmed 20%, focus trapped in the panel.
//   closing  displayed but pointerEvents none, so the screen underneath is usable at once; the
//            panel slides back out. When it ends the overlay goes back to `closed`.
export default function SideMenu({ visible, onClose, navigation, currentScreen }) {
  const { user } = useApp();
  const { t, i18n } = useTranslation();
  // Static mirroring of the edge svg (the bulge is drawn left-to-right; Hebrew flips it).
  const rtl = isRTL(i18n.language);

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
  // The moving wrapper: its transform (the slide) is written to the DOM each frame.
  const slideRef = useRef(null);
  // The elastic edge paths (one fill, several shadow strokes); their `d` is written each frame.
  const fillPathRef = useRef(null);
  const shadowPathRefs = useRef([]);
  // The last bulge (px) written to the edge, so a reversed animation can fade it out smoothly.
  const bulgeRef = useRef(0);
  // The running row fade-in animations (Web Animations API), so they can be cancelled.
  const rowAnimsRef = useRef([]);
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

  // Drives the slide. useLayoutEffect runs after the commit that displayed the overlay but
  // BEFORE the browser paints it, so the starting values are in place before the first frame.
  //
  // Why values are written straight to the DOM (node.style.transform / opacity and the SVG `d`
  // attribute) and not through React props: they change every frame; going through React would
  // re-render per frame and any unrelated re-render could overwrite them. The SVG paths are
  // rendered by React with CONSTANT strings (the flat edge); because that prop value never
  // changes, React never touches the attribute again, so the live value written here survives.
  //
  // Why the clock starts in the FIRST animation frame and not at the tap: on a slow phone,
  // building and showing the overlay can take a while; a clock started at the tap would have run
  // out before anything was visible and the menu would jump. That first callback counts as 16 ms.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const slide = slideRef.current;
    const dim = dimRef.current;
    if (!overlay || !slide || !dim) return undefined;
    if (!visible && !activeRef.current) return undefined; // first mount, still closed
    activeRef.current = visible;

    // Any new animation stops the row fade-ins of the previous one (rows then sit at full opacity,
    // so a close never staggers and a re-open from half-way does not restart them).
    rowAnimsRef.current.forEach(a => a.cancel());
    rowAnimsRef.current = [];

    const target = visible ? 1 : 0;
    const p0 = progressRef.current;
    const width = slide.offsetWidth;
    const height = slide.offsetHeight;
    // Direction is read at the start of each animation (a language switch can change it).
    const rtl = getComputedStyle(overlay).direction === 'rtl';
    // Distance the slide travels when fully hidden: the panel width plus the edge strip that
    // sticks out beyond the panel, so no part of the strip peeks in when closed.
    const travel = width + STRIP_OUT;
    // How far the slide is moved off-screen at progress p (0 = in place).
    const offsetAt = p => (1 - p) * travel;

    // Writes the edge paths for a bulge in px (0 = flat) and remembers it for the reversal blend.
    const writeEdge = bulge => {
      bulgeRef.current = bulge;
      fillPathRef.current?.setAttribute('d', edgeFillPath(bulge));
      const shadows = edgeShadowPaths(bulge);
      shadowPathRefs.current.forEach((el, i) => el?.setAttribute('d', shadows[i]));
    };
    // Writes the flat edge strings back (the same values React renders).
    const writeFlatEdge = () => {
      bulgeRef.current = 0;
      fillPathRef.current?.setAttribute('d', FLAT_FILL);
      shadowPathRefs.current.forEach((el, i) => el?.setAttribute('d', FLAT_SHADOWS[i]));
    };
    // Moves the slide to progress p; dim = the visible fraction of the panel (never darker than
    // the menu is open).
    const writeSlide = p => {
      const offset = offsetAt(p);
      slide.style.transform = `translateX(${rtl ? offset : -offset}px)`;
      dim.style.opacity = String(Math.min(1, Math.max(0, (width - offset) / width)));
    };

    // Removes the inline values: slide in place, dim at its full CSS value (darkness 0.2), flat edge.
    const clearInline = () => {
      slide.style.transform = '';
      dim.style.opacity = '';
      writeFlatEdge();
    };
    // Writes the CLOSED look: slide fully off-screen (strip included), no dim, flat edge.
    const writeClosedLook = () => {
      writeSlide(0);
      writeFlatEdge();
    };
    // End of a close: hide the overlay and tell MenuBody it can reset.
    // Called from an animation frame, a state update (setShown) is applied by React in a LATER
    // task, so the browser paints this frame first. If we cleared the inline values here the
    // overlay would flash fully open (slide in place, full dim) for one frame. So the animated
    // close writes the closed look and the overlay stays invisible until display:none arrives.
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

    // Rows fade in one after another, only when opening from fully closed (not on a re-open from
    // half-way). Web Animations API: the browser runs them, React does not re-render. `backwards`
    // fill keeps each row invisible until its own delay is over.
    if (target && p0 === 0) {
      const rows = slide.querySelector('[data-testid="side-menu-rows"]');
      const els = rows ? Array.from(rows.children) : [];
      const delays = rowDelays(els.length);
      els.forEach((el, i) => {
        if (typeof el.animate !== 'function') return;
        rowAnimsRef.current.push(el.animate(
          [
            { opacity: 0, transform: `translateX(${rtl ? ROW_SHIFT_PX : -ROW_SHIFT_PX}px)` },
            { opacity: 1, transform: 'none' },
          ],
          { duration: ROW_DURATION_MS, delay: delays[i], easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
        ));
      });
    }

    // Duration is scaled by the distance left, so reversing mid-way continues smoothly.
    const dist = Math.abs(target - p0);
    const duration = (target ? OPEN_MS : CLOSE_MS) * dist;
    const ease = target ? easeOpen : easeClose;
    // Bulge left over from the animation we are interrupting; it fades out over BLEND_MS so the
    // edge never jumps when the user reverses mid-way.
    const b0 = bulgeRef.current;
    // When opening, the loop keeps running after the slide has landed (tau = 1) until the edge
    // wobble is finished (OPEN_SETTLE_MS), so the single inward dip plays out.
    const endTau = target ? OPEN_SETTLE_MS / OPEN_MS : 1;
    let startTs = null;

    const frame = ts => {
      if (startTs === null) startTs = ts - 16;
      const elapsed = ts - startTs;
      // No distance to travel (duration 0): everything is already finished.
      const tau = duration > 0 ? elapsed / duration : Infinity;
      const p = tau >= 1 ? target : p0 + (target - p0) * ease(tau);
      progressRef.current = p;
      if (tau >= endTau) {
        rafRef.current = 0;
        if (target) clearInline();
        else finishClose(true);
        return;
      }
      // Bulge of this frame: the timeline (scaled by distance, so a short re-open bulges a little)
      // plus the fading remainder of the interrupted animation's bulge.
      const timeline = (target ? openBulge(tau * OPEN_MS) : closeBulge(tau)) * dist;
      writeEdge(timeline + b0 * Math.max(0, 1 - elapsed / BLEND_MS));
      if (target && p === 1) {
        // Landed, still wobbling: the slide is in place, so clear its inline values.
        slide.style.transform = '';
        dim.style.opacity = '';
      } else {
        writeSlide(p);
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(frame);

    // New animation or unmount: stop the loop. progressRef keeps the current value.
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible]);

  // On unmount stop any running row animations.
  useEffect(() => () => { rowAnimsRef.current.forEach(a => a.cancel()); }, []);

  // Answer of THIS opening: null until it arrives, then 'on' (row shown) or 'off' (nothing; the
  // server says disabled, or the request failed).
  const [openingAnswer, setOpeningAnswer] = useState(null);
  // What the booking row shows: this opening's answer, else the last known answer, else
  // 'loading' (only the very first opening: an empty placeholder keeps the row's space).
  // Passed to MenuBody as a plain string, so the memoized body re-renders only when it changes.
  const bookingState = openingAnswer ?? lastBookingAnswer ?? 'loading';

  // Ask the server on every opening whether booking is on; the "Book" row shows only if so.
  // While closed we forget this opening's answer, so the next opening starts from the last known
  // answer (or the placeholder on the first one). `cancelled` ignores a late answer from an
  // earlier opening (the cleanup runs when the menu closes or reopens), so it is never stored.
  // This lives here (not in MenuBody) because MenuBody deliberately does not receive `visible`.
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

  // Focus handling (what the old Modal gave for free). While the menu is open:
  //   - focus moves into the panel (the X button) and the previous focus is remembered;
  //   - Tab / Shift+Tab wrap inside the panel; focus that escapes is pulled back in;
  //   - Escape closes. When it closes, focus returns to what had it (if it still exists).
  useEffect(() => {
    const overlay = overlayRef.current;
    const panelItems = () => Array.from(slideRef.current?.querySelectorAll(FOCUSABLE) || []);

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
        {/* The slide: the whole panel moves with one CSS transform, written to the DOM every
            frame (never a React style key). Nothing inside may clip, so the bulge can stick out. */}
        <View ref={slideRef} testID="side-menu-slide" style={s.panelWrap}>
          {/* Panel colour. It stops 1 px short of the straight edge: the strip paints the last
              EDGE_INSET px, and the overlap hides any hairline seam between the two. */}
          <View aria-hidden={true} style={s.panelBg} />
          {/* Elastic edge strip, sticking out beyond the panel's trailing edge. Its paths are
              rendered flat here; the animation loop rewrites `d` with setAttribute. */}
          <View aria-hidden={true} style={s.edgeBox}>
            <svg
              data-testid="side-menu-edge"
              aria-hidden="true"
              width="100%"
              height="100%"
              viewBox={`0 0 ${STRIP_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              style={{ display: 'block', transform: rtl ? 'scaleX(-1)' : undefined }}
            >
              {SHADOW_STEPS.map((step, i) => (
                <path
                  key={i}
                  ref={el => { shadowPathRefs.current[i] = el; }}
                  data-edge="shadow"
                  d={FLAT_SHADOWS[i]}
                  fill="none"
                  stroke={`rgba(0,0,0,${step.alpha})`}
                  strokeWidth={SHADOW_STROKE_PX}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path ref={fillPathRef} data-edge="fill" d={FLAT_FILL} fill={C.bg} />
            </svg>
          </View>
          <MenuBody
            currentScreen={currentScreen}
            onClose={onClose}
            navigationRef={navigationRef}
            closedCount={closedCount}
            scrollRef={scrollRef}
            bookingState={bookingState}
          />
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
  // 20% black; its opacity (0..1) is animated through the DOM (the visible fraction of the panel).
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)', pointerEvents: 'none' },
  row: { flex: 1, flexDirection: 'row' },
  panelWrap: { width: '82%', maxWidth: 320 },
  // Panel colour layer (see the slide in the render): stops 1 px short of the edge strip.
  panelBg: { position: 'absolute', top: 0, bottom: 0, start: 0, end: EDGE_INSET - 1, backgroundColor: C.bg, pointerEvents: 'none' },
  // Box holding the edge svg: sticks out STRIP_OUT px beyond the panel's trailing edge.
  edgeBox: { position: 'absolute', top: 0, bottom: 0, end: -STRIP_OUT, width: STRIP_W, pointerEvents: 'none' },
  // Fills the whole slide width; its colour comes from panelBg and the edge svg.
  panel: { flex: 1 },
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
