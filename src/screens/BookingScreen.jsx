import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { MenuButton } from '../components/SideMenu';
import { useApp } from '../context/AppContext';
import { errorText } from '../lib/errorText';
import { formatTime } from '../lib/formatting';
import { isRTL } from '../lib/language';
import {
  fetchSlots, fetchMine, createBooking, groupSlotsByDate, formatSlotDay, formatBookingWhen,
  MAX_NOTE_LENGTH,
} from '../lib/bookingApi';

// Book a consultation. Flow (see AI/plans/in-app-booking-contract.md section 8):
//  - load the user's bookings and the free times;
//  - if the user already has an upcoming booking, show it (one at a time) instead of the picker;
//  - otherwise pick a day, a time, optionally write a note, and confirm.
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
  const [confirmed, setConfirmed] = useState(null);   // { booking, warning } after a success

  // Fetch the bookings and the free times together; any failure shows the retry state.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [mine, free] = await Promise.all([fetchMine(), fetchSlots()]);
      setUpcoming(mine.upcoming || null);
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
    try { setUpcoming((await fetchMine()).upcoming || null); } catch { /* keep what we show */ }
  }

  async function confirm() {
    if (!slot || sending) return;
    setSending(true);
    setSubmitError(null);
    try {
      // The body is always { startsAt, note }; no note is sent as ''.
      const result = await createBooking({ startsAt: slot.startsAt, note: note.trim() });
      setConfirmed(result);
      reloadMine();
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
        {!analysis && (
          <Text testID="booking-no-analysis-warning" style={[s.warning, align]}>
            {t('booking:noAnalysisWarning')}
          </Text>
        )}

        <Text style={[s.label, align]}>{t('booking:pickDay')}</Text>
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

        <Text style={[s.label, align]}>{t('booking:pickTime')}</Text>
        <View style={s.times}>
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
          <Text style={s.buttonText}>{sending ? t('booking:confirming') : t('booking:confirm')}</Text>
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
  card:        { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 18 },
  cardTitle:   { fontFamily: 'CormorantGaramond_500Medium', fontSize: 20, color: C.text, marginBottom: 6 },
  when:        { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.text, marginBottom: 10 },
  body:        { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, lineHeight: 20 },
});
