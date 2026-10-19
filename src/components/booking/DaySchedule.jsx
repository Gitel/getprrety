// The list of times of ONE day: one row per entry, time on the start side, status block after it.
//   free row   -> pressable radio ("Available", or "Your time" when it is the selected slot)
//   taken row  -> grey, NOT pressable ("Taken")
//   no rows    -> "There are no times on this day."
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { formatTime } from '../../lib/formatting';

export default function DaySchedule({ rows, selectedSlot, onSelectSlot, accent, lang, large }) {
  const { t } = useTranslation();

  if (!rows || rows.length === 0) {
    return <Text testID="booking-day-closed" style={s.closed}>{t('booking:closedDay')}</Text>;
  }

  return (
    <View role="radiogroup" aria-label={t('booking:pickTime')} style={s.list}>
      {rows.map((row) => {
        const rowStyle = [s.row, large && s.rowLarge];
        const timeStyle = [s.time, large && s.timeLarge];

        if (row.taken) {
          // A plain View has no onPress, so a tap does nothing. aria-disabled tells screen readers.
          return (
            <View key={row.startsAt} testID={`booking-taken-${row.time}`} aria-disabled={true} style={[rowStyle, s.rowTaken]}>
              <Text style={[timeStyle, s.timeTaken]}>{formatTime(row.time, lang)}</Text>
              <View style={[s.block, s.blockTaken]}>
                <Text style={[s.blockText, s.blockTextTaken]}>{t('booking:taken')}</Text>
              </View>
            </View>
          );
        }

        const on = selectedSlot?.startsAt === row.startsAt;
        return (
          <Pressable
            key={row.startsAt}
            testID={`booking-slot-${row.time}`}
            // Radio role + aria-checked: screen readers announce the chosen time as selected.
            role="radio"
            aria-checked={on}
            onPress={() => onSelectSlot(row)}
            style={rowStyle}
          >
            <Text style={timeStyle}>{formatTime(row.time, lang)}</Text>
            <View style={[s.block, on ? { backgroundColor: accent, borderColor: accent } : { borderColor: accent }]}>
              <Text style={[s.blockText, { color: on ? '#FFFFFF' : accent }]}>
                {on ? t('booking:yourTime') : t('booking:available')}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  list:           { gap: 8 },
  // minHeight 44 is above the 40 px touch-target minimum.
  row:            { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12 },
  rowLarge:       { minHeight: 56, paddingHorizontal: 16 },
  rowTaken:       { backgroundColor: C.bg },
  time:           { width: 84, fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text },
  timeLarge:      { width: 96, fontSize: 16 },
  timeTaken:      { color: C.muted },
  // The block fills the rest of the row, so the whole row looks like one big target.
  block:          { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingVertical: 4 },
  blockTaken:     { backgroundColor: C.border, borderColor: C.border },
  blockText:      { fontFamily: 'DMSans_500Medium', fontSize: 13 },
  blockTextTaken: { color: C.muted },
  closed:         { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', paddingVertical: 20 },
});
