// The calendar "surface" every view sits on: a tinted card with a border and a soft shadow.
// testID booking-calendar-card is used by the e2e tests to measure the card.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { CAL, useIsWide } from './calendarTheme';

export default function CalendarCard({ children }) {
  const wide = useIsWide();
  return (
    <View testID="booking-calendar-card" style={[s.card, { padding: wide ? 16 : 12 }]}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: CAL.card,
    borderWidth: 1,
    borderColor: CAL.border,
    borderRadius: 16,
    // Soft shadow so the card lifts off the page (react-native-web turns this into box-shadow).
    shadowColor: '#8A6F5E',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
});
