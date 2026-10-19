// Segmented control "Month | Week | Day" shown above the booking calendar.
// It only reports the choice (onChange); the screen owns the `view` state.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';

// [view id, i18n key]. Order = order on screen (mirrored automatically in Hebrew).
const VIEWS = [
  ['month', 'booking:viewMonth'],
  ['week', 'booking:viewWeek'],
  ['day', 'booking:viewDay'],
];

export default function ViewSwitcher({ view, onChange, accent }) {
  const { t } = useTranslation();
  return (
    <View style={s.wrap} role="tablist">
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
            style={[s.segment, on && { backgroundColor: accent }]}
          >
            <Text style={[s.text, on && s.textOn]}>{t(key)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap:    { flexDirection: 'row', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  text:    { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.muted },
  textOn:  { color: '#FFFFFF' },
});
