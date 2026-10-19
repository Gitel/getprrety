// Pop-up shown when a day is pressed in the Month view: that day's times as a compact grid of
// small buttons (4 per row on a desktop, 3 on a phone).
//   free button     -> white, accent border + text, hover tint; picking it calls onSelectSlot(slot)
//                      (the screen then closes the pop-up)
//   selected button -> accent fill, white text
//   taken button    -> grey, struck through, NOT pressable
//   full day        -> only taken buttons plus the text "This day is fully booked."
// It closes with the x button, a press on the dark overlay, or Escape (react-native-web's Modal
// calls onRequestClose for Escape).
import React, { useEffect } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { formatTime } from '../../lib/formatting';
import { formatSlotDay } from '../../lib/bookingApi';
import { isRTL } from '../../lib/language';
import { CAL, tint, useIsWide } from './calendarTheme';

export default function DayTimesModal({ date, rows, selectedSlot, onSelectSlot, onClose, accent, lang }) {
  const { t } = useTranslation();
  const wide = useIsWide();
  const columns = wide ? 4 : 3;
  const title = formatSlotDay(date, lang);
  const hasFree = rows.some((r) => !r.taken);

  // Escape closes the pop-up (web only). react-native-web's Modal also does this, but only after its
  // fade-in animation reports "done", which does not happen with reduced motion; this listener
  // always works.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        {/* The dark overlay is a full-size button underneath the card: pressing it closes the pop-up. */}
        <Pressable testID="booking-popup-overlay" style={s.overlay} onPress={onClose} aria-label={t('booking:close')} />

        <View testID="booking-popup" role="dialog" aria-modal={true} aria-label={title} style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>{isRTL(lang) ? `⁨${title}⁩` : title}</Text>
            <Pressable
              testID="booking-popup-close"
              role="button"
              aria-label={t('booking:close')}
              onPress={onClose}
              style={({ hovered }) => [s.close, hovered && s.closeHover]}
            >
              <Text style={s.closeGlyph}>{'×'}</Text>
            </Pressable>
          </View>

          {/* Wrapping row; every item is 1/columns of the width, so the buttons form a neat grid. */}
          <View role="radiogroup" aria-label={t('booking:pickTime')} style={s.grid}>
            {rows.map((row) => {
              const label = formatTime(row.time, lang);
              if (row.taken) {
                return (
                  <View key={row.startsAt} style={[s.item, { width: `${100 / columns}%` }]}>
                    <View
                      testID={`booking-taken-${row.time}`}
                      aria-disabled={true}
                      aria-label={`${title}, ${label}, ${t('booking:taken')}`}
                      style={[s.button, s.buttonTaken]}
                    >
                      <Text style={[s.buttonText, s.textTaken]}>{label}</Text>
                    </View>
                  </View>
                );
              }
              const on = selectedSlot?.startsAt === row.startsAt;
              return (
                <View key={row.startsAt} style={[s.item, { width: `${100 / columns}%` }]}>
                  <Pressable
                    testID={`booking-slot-${row.time}`}
                    // Radio role + aria-checked: screen readers announce the chosen time as selected.
                    role="radio"
                    aria-checked={on}
                    aria-label={`${title}, ${label}`}
                    onPress={() => onSelectSlot(row)}
                    // hovered (web): ~10 % accent fill; selected = full accent fill.
                    style={({ hovered }) => [
                      s.button,
                      { borderColor: accent },
                      hovered && { backgroundColor: tint(accent, 0.1) },
                      on && { backgroundColor: accent },
                    ]}
                  >
                    <Text style={[s.buttonText, { color: on ? '#FFFFFF' : accent }]}>{label}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {!hasFree && <Text style={s.fullDay}>{t('booking:fullDay')}</Text>}

          <View style={s.legend}>
            <View style={s.legendItem}>
              <View style={[s.swatch, { borderColor: accent }]} />
              <Text style={s.legendText}>{t('booking:available')}</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.swatch, { backgroundColor: CAL.taken, borderColor: CAL.taken }]} />
              <Text style={s.legendText}>{t('booking:taken')}</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlayWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  overlay:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(44,44,44,0.35)' },
  card:        { width: '100%', maxWidth: 420, backgroundColor: C.card, borderRadius: 18, padding: 20, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 },
  title:       { flex: 1, fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.text },
  close:       { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  closeHover:  { backgroundColor: 'rgba(0,0,0,0.06)' },
  closeGlyph:  { fontFamily: 'DMSans_400Regular', fontSize: 24, lineHeight: 26, color: C.muted },
  // Negative margin cancels the 4 px padding of the items at the grid edges.
  grid:        { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  item:        { padding: 4 },
  button:      { height: 40, borderRadius: 10, borderWidth: 1, borderColor: 'transparent', backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  buttonTaken: { backgroundColor: CAL.taken },
  buttonText:  { fontFamily: 'DMSans_500Medium', fontSize: 14 },
  textTaken:   { color: C.muted, textDecorationLine: 'line-through' },
  fullDay:     { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 10 },
  legend:      { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 16 },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  swatch:      { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
});
