// Compact segmented toggle "Month | Week | Day" shown above the booking calendar.
// It only reports the choice (onChange); the screen owns the `view` state.
// Layout: a small pill (about 220 px wide, NOT full width) at the END of its row: the right side in
// English and the left side in Hebrew (the row is mirrored by the page's dir="rtl").
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { CAL } from './calendarTheme';

// [view id, i18n key]. Order = order on screen (mirrored automatically in Hebrew).
const VIEWS = [
  ['month', 'booking:viewMonth'],
  ['week', 'booking:viewWeek'],
  ['day', 'booking:viewDay'],
];

export default function ViewSwitcher({ view, onChange, accent }) {
  const { t } = useTranslation();
  return (
    // The outer row only pushes the pill to the end; the pill itself has an automatic width.
    <View style={s.row}>
      <View testID="booking-view-switcher" style={s.track} role="tablist">
        {VIEWS.map(([id, key]) => {
          const on = view === id;
          return (
            <Pressable
              key={id}
              testID={`booking-view-${id}`}
              // tab role + aria-selected: screen readers announce which view is active.
              role="tab"
              aria-selected={on}
              onPress={() => onChange(id)}
              // hovered = mouse is over it (web only); the active segment is white with a small shadow.
              style={({ hovered }) => [s.segment, on && s.segmentOn, !on && hovered && s.segmentHover]}
            >
              <Text style={[s.text, on && { color: accent }]}>{t(key)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row:          { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
  track:        { flexDirection: 'row', alignItems: 'center', height: 34, borderRadius: 17, backgroundColor: CAL.band, padding: 3 },
  segment:      { height: 28, minWidth: 64, paddingHorizontal: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  segmentOn:    { backgroundColor: C.card, shadowColor: '#8A6F5E', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segmentHover: { backgroundColor: 'rgba(255,255,255,0.55)' },
  text:         { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.muted },
});
