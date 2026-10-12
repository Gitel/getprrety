import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { MenuButton } from '../components/SideMenu';
import { useApp } from '../context/AppContext';
import { errorText } from '../lib/errorText';
import { formatTime } from '../lib/formatting';
import { onAppResume } from '../lib/resumeRefresh';
import { openCheckout } from '../lib/openCheckout';
import { isRTL } from '../lib/language';
import {
  fetchSlots, fetchMine, createBooking, groupSlotsByDate, formatSlotDay, formatBookingWhen,
  isLiveHold, clinicHHMM, MAX_NOTE_LENGTH,
} from '../lib/bookingApi';

// How often the waiting-for-payment panel re-checks the server (ms).
const PAYMENT_POLL_MS = 5000;

// Book a consultation. Flow (see AI/plans/in-app-booking-contract.md section 8 and
// AI/plans/paid-booking-and-signin-link-contract.md section 6):
//  - load the user's bookings and the free times;
//  - if the user already has an upcoming booking, show it (one at a time) instead of the picker;
//  - otherwise pick a day, a time, optionally write a note, and continue to payment:
//    the server holds the time for a few minutes (status pending_payment) and we show a
//    waiting panel with a Pay now button; while it is shown we poll until the booking is
//    confirmed (paid) or the hold runs out.
// All times shown are CLINIC time, taken from the server's date/time fields.
export default function BookingScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { analysis } = useApp();
  const accent = analysis?.era?.color || C.accent;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);   // text to show with the retry button
  const [upcoming, setUpcoming] = useState(null);     // the user's upcoming booking, if any
  const [groups, setGroups] = useState([]);           // [{ date, slots }]
  const [day, setDay] = useState(null);               // selected 'YYYY-MM-DD'
  const [slot, setSlot] = useState(null);             // selected slot object
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [confirmed, setConfirmed] = useState(null);   // { booking, warning } once paid
  const [pending, setPending] = useState(null);       // { booking, warning } while waiting for payment
  const [holdExpired, setHoldExpired] = useState(false); // show the 'time ran out' notice above the picker

  // Put the server's "upcoming" booking in the right place: a live unpaid hold opens the
  // waiting panel, anything else is the normal "your upcoming consultation" card.
  function applyMine(mine) {
    const up = mine.upcoming || null;
    if (isLiveHold(up)) {
      setPending(prev => (prev && prev.booking.id === up.id ? prev : { booking: up, warning: null }));
      setUpcoming(null);
    } else {
      setUpcoming(up);
    }
  }

  // Fetch the bookings and the free times together; any failure shows the retry state.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [mine, free] = await Promise.all([fetchMine(), fetchSlots()]);
      applyMine(mine);
      setGroups(groupSlotsByDate(free.slots || []));
    } catch (err) {
      setLoadError(errorText(err, t, 'booking:loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, []);

  // Only the free times again (after someone else took our slot). Keeps the selected day.
  async function reloadSlots() {
    try {
      const free = await fetchSlots();
      setGroups(groupSlotsByDate(free.slots || []));
    } catch (err) {
      setLoadError(errorText(err, t, 'booking:loadFailed'));
    }
  }

  async function reloadMine() {
    try { applyMine(await fetchMine()); } catch { /* keep what we show */ }
  }

  async function confirm() {
    if (!slot || sending) return;
    setSending(true);
    setSubmitError(null);
    setHoldExpired(false);
    try {
      // The body is always { startsAt, note }; no note is sent as ''.
      const result = await createBooking({ startsAt: slot.startsAt, note: note.trim() });
      // 201 pending_payment: the time is held; show the waiting panel (no server call needed).
      setPending(result);
    } catch (err) {
      setSubmitError(errorText(err, t, 'booking:bookFailed'));
      if (err.code === 'slot_taken' || err.code === 'slot_invalid') {
        setSlot(null);      // the time is gone; the user picks again
        reloadSlots();
      } else if (err.code === 'limit_reached') {
        reloadMine();       // the user already has one: show it
      }
    } finally {
      setSending(false);
    }
  }

  // While the waiting panel is visible, ask the server every few seconds (and when the app
  // returns to the foreground, e.g. after paying in another window) whether the booking is paid.
  // The effect depends on the booking id only, so leaving the panel clears the timer.
  const pendingId = pending?.booking.id;
  useEffect(() => {
    if (!pendingId) return undefined;
    let stopped = false;
    async function check() {
      let mine;
      try { mine = await fetchMine(); } catch { return; } // a network blip: try again next tick
      if (stopped) return;
      const up = mine.upcoming || null;
      if (up && up.id === pendingId && up.status === 'confirmed') {
        // Paid: the Shopify webhook confirmed it.
        setConfirmed({ booking: up, warning: pending.warning });
        setPending(null);
      } else if (!(up && up.id === pendingId && isLiveHold(up))) {
        // Hold ran out (or was replaced/cancelled): back to the picker with a notice.
        setPending(null);
        setHoldExpired(true);
        reloadSlots();
      }
    }
    const timer = setInterval(check, PAYMENT_POLL_MS);
    const stopResume = onAppResume(check);
    return () => { stopped = true; clearInterval(timer); stopResume(); };
  }, [pendingId]);

  // The selected day falls back to the first day if it has disappeared after a refetch.
  const activeGroup = groups.find(g => g.date === day) || groups[0] || null;
  const canConfirm = Boolean(slot) && !sending;

  // In Hebrew, isolate marks keep digits/punctuation of a date from reordering the sentence.
  const iso = text => (isRTL(lang) ? `\u2068${text}\u2069` : text);
  const align = isRTL(lang) ? { textAlign: 'right' } : null;

  function renderBody() {
    if (loading) {
      return <Text testID="booking-loading" style={s.muted}>{t('booking:loading')}</Text>;
    }
    if (loadError) {
      return (
        <View style={s.center}>
          <Text testID="booking-error" style={s.error}>{loadError}</Text>
          <Pressable testID="booking-retry" onPress={load} style={[s.button, { backgroundColor: accent }]}>
            <Text style={s.buttonText}>{t('booking:retry')}</Text>
          </Pressable>
        </View>
      );
    }
    if (confirmed) {
      return (
        <View testID="booking-confirmed" style={s.card}>
          <Text style={[s.cardTitle, align]}>{t('booking:confirmedTitle')}</Text>
          <Text testID="booking-confirmed-when" style={[s.when, align]}>
            {iso(formatBookingWhen(confirmed.booking, lang))}
          </Text>
          <Text style={[s.body, align]}>{t('booking:confirmedBody')}</Text>
          {confirmed.warning === 'no_analysis' && (
            <Text testID="booking-no-analysis-warning" style={[s.warning, align]}>
              {t('booking:noAnalysisWarning')}
            </Text>
          )}
        </View>
      );
    }
    if (pending) {
      return (
        <View testID="booking-awaiting-payment" style={s.card}>
          <Text style={[s.cardTitle, align]}>{t('booking:awaitingTitle')}</Text>
          <Text testID="booking-selected-when" style={[s.when, align]}>
            {iso(formatBookingWhen(pending.booking, lang))}
          </Text>
          {/* The deadline is shown in CLINIC time (Asia/Jerusalem), never the phone's zone. */}
          <Text testID="booking-hold-until" style={[s.body, align]}>
            {t('booking:awaitingBody', { time: iso(formatTime(clinicHHMM(pending.booking.holdExpiresAt), lang)) })}
          </Text>
          {pending.warning === 'no_analysis' && (
            <Text testID="booking-no-analysis-warning" style={[s.warning, align]}>
              {t('booking:noAnalysisWarning')}
            </Text>
          )}
          <Pressable
            testID="booking-pay-now"
            onPress={() => openCheckout(pending.booking.checkoutUrl)}
            style={[s.button, { backgroundColor: accent }]}
          >
            <Text style={s.buttonText}>{t('booking:payNow')}</Text>
          </Pressable>
          {/* No server call: the next POST replaces this hold. */}
          <Pressable
            testID="booking-choose-other"
            onPress={() => { setPending(null); setSlot(null); reloadSlots(); }}
            style={[s.button, s.buttonGhost]}
          >
            <Text style={[s.buttonText, { color: accent }]}>{t('booking:chooseOther')}</Text>
          </Pressable>
        </View>
      );
    }
    if (upcoming) {
      return (
        <View testID="booking-upcoming" style={s.card}>
          <Text style={[s.cardTitle, align]}>{t('booking:upcomingTitle')}</Text>
          <Text testID="booking-upcoming-when" style={[s.when, align]}>
            {iso(formatBookingWhen(upcoming, lang))}
          </Text>
          <Text style={[s.body, align]}>{t('booking:upcomingHelp')}</Text>
          <Pressable
            testID="booking-message-clinic"
            onPress={() => navigation.navigate('Messages')}
            style={[s.button, { backgroundColor: accent }]}
          >
            <Text style={s.buttonText}>{t('booking:messageClinic')}</Text>
          </Pressable>
        </View>
      );
    }
    if (groups.length === 0) {
      return <Text testID="booking-empty" style={s.muted}>{t('booking:empty')}</Text>;
    }
    return (
      <View>
        {holdExpired && (
          <Text testID="booking-hold-expired" style={[s.warning, align]}>{t('booking:holdExpired')}</Text>
        )}
        {!analysis && (
          <Text testID="booking-no-analysis-warning" style={[s.warning, align]}>
            {t('booking:noAnalysisWarning')}
          </Text>
        )}

        <Text style={[s.label, align]}>{t('booking:pickDay')}</Text>
        {/* radiogroup + label: a screen reader treats the day chips as one group, separate from the times */}
        <View role="radiogroup" aria-label={t('booking:pickDay')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {groups.map(g => {
            const on = g.date === activeGroup.date;
            return (
              <Pressable
                key={g.date}
                testID={`booking-day-${g.date}`}
                // Radio role + aria-checked: screen readers announce the chosen day/time as selected.
                role="radio"
                aria-checked={on}
                onPress={() => { setDay(g.date); setSlot(null); setSubmitError(null); }}
                style={[s.chip, on && { backgroundColor: accent, borderColor: accent }]}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{formatSlotDay(g.date, lang)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        </View>

        <Text style={[s.label, align]}>{t('booking:pickTime')}</Text>
        <View style={s.times} role="radiogroup" aria-label={t('booking:pickTime')}>
          {activeGroup.slots.map(sl => {
            const on = slot?.startsAt === sl.startsAt;
            return (
              <Pressable
                key={sl.startsAt}
                testID={`booking-slot-${sl.time}`}
                // Radio role + aria-checked: screen readers announce the chosen day/time as selected.
                role="radio"
                aria-checked={on}
                onPress={() => { setSlot(sl); setSubmitError(null); }}
                style={[s.chip, on && { backgroundColor: accent, borderColor: accent }]}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{formatTime(sl.time, lang)}</Text>
              </Pressable>
            );
          })}
        </View>

        {slot && (
          <Text testID="booking-selected" style={[s.selected, align]}>
            {t('booking:selected', { when: iso(formatBookingWhen(slot, lang)) })}
          </Text>
        )}

        <Text style={[s.label, align]}>{t('booking:noteLabel')}</Text>
        <TextInput
          testID="booking-note"
          style={[s.input, align]}
          value={note}
          onChangeText={setNote}
          placeholder={t('booking:notePlaceholder')}
          placeholderTextColor={C.muted}
          multiline
          maxLength={MAX_NOTE_LENGTH}
        />

        {submitError && <Text testID="booking-submit-error" style={[s.error, align]}>{submitError}</Text>}

        <Pressable
          testID="booking-confirm"
          onPress={confirm}
          disabled={!canConfirm}
          accessibilityState={{ disabled: !canConfirm }}
          style={[s.button, { backgroundColor: accent }, !canConfirm && { opacity: 0.5 }]}
        >
          <Text style={s.buttonText}>{sending ? t('booking:confirming') : t('booking:continueToPayment')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} testID="booking-screen">
      <View style={s.header}>
        {/* Same as Messages: a menu button only. Going back is the edge swipe. */}
        <View style={s.topRow}>
          <MenuButton onPress={navigation.openMenu} color={accent} />
        </View>
        <Text style={[s.pageTitle, align]}>{t('booking:title')}</Text>
        <Text style={[s.subtitle, align]}>{t('booking:subtitle')}</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  header:      { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8 },
  topRow:      { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  pageTitle:   { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: C.text, marginBottom: 4 },
  subtitle:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  content:     { paddingHorizontal: 24, paddingVertical: 12, paddingBottom: 40 },
  center:      { alignItems: 'center', gap: 14, marginTop: 24 },
  muted:       { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 24 },
  label:       { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, marginTop: 16, marginBottom: 8 },
  chips:       { gap: 8 },
  times:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { borderWidth: 1, borderColor: C.border, backgroundColor: C.card, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14 },
  chipText:    { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text },
  chipTextOn:  { color: '#FFFFFF' },
  selected:    { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginTop: 16 },
  input:       { minHeight: 70, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E8DDD8', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#2C2C2C' },
  error:       { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C44B4B', marginTop: 10 },
  warning:     { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, backgroundColor: C.accentLight, borderRadius: 10, padding: 10, marginTop: 8 },
  button:      { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 20, alignItems: 'center', marginTop: 16 },
  buttonText:  { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#FFFFFF' },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border },
  card:        { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18 },
  cardTitle:   { fontFamily: 'CormorantGaramond_500Medium', fontSize: 20, color: C.text, marginBottom: 6 },
  when:        { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.text, marginBottom: 10 },
  body:        { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, lineHeight: 20 },
});
