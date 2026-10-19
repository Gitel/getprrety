// Day view: the date as a title with previous/next-day arrows, then the same time-grid look as the
// Week view but with ONE day column: a time column + one wide cell per time, row dividers, 44 px rows.
//   free     -> ~8 % accent tint with a small accent "Available" at the start; hover = ~22 % tint
//   selected -> accent fill with a white "Your time"
//   taken    -> grey with a muted "Taken", NOT pressable
// Arrows move one calendar day at a time and stop at the edges of the range. A day without times is
// not skipped: it shows the "no times on this day" message.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { isRTL } from '../../lib/language';
import { formatTime } from '../../lib/formatting';
import { formatSlotDay } from '../../lib/bookingApi';
import { addDays } from '../../lib/bookingCalendar';
import { CAL, tint } from './calendarTheme';
import CalendarCard from './CalendarCard';
import NavHeader from './NavHeader';

const ROW_HEIGHT = 44;

export default function DayView({
  index, today, range, focusDate, onFocusDate, selectedSlot, onSelectSlot, accent, lang,
}) {
  const { t } = useTranslation();
  const shown = focusDate || today;
  const title = formatSlotDay(shown, lang);
  const rows = index.get(shown) || [];

  // The caller only needs the new date; we never leave [range.min, range.max].
  const prevDisabled = shown <= range.min;
  const nextDisabled = shown >= range.max;

  return (
    <CalendarCard>
      <NavHeader
        lang={lang}
        // Isolate marks keep digits and punctuation of the date in order inside Hebrew text.
        title={isRTL(lang) ? `⁨${title}⁩` : title}
        titleTestID="booking-dayview-label"
        prevTestID="booking-dayview-prev"
        nextTestID="booking-dayview-next"
        prevLabel={t('booking:prevDay')}
        nextLabel={t('booking:nextDay')}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
        onPrev={() => onFocusDate(addDays(shown, -1))}
        onNext={() => onFocusDate(addDays(shown, 1))}
      />

      {rows.length === 0 ? (
        <Text testID="booking-day-closed" style={s.closed}>{t('booking:closedDay')}</Text>
      ) : (
        // Grid box: the background is the line colour, the 1 px gaps between rows draw the dividers.
        <View role="radiogroup" aria-label={t('booking:pickTime')} style={s.grid}>
          {rows.map((row) => {
            const time = formatTime(row.time, lang);
            const timeCell = (
              <View style={s.timeCol}>
                <Text style={s.timeLabel} numberOfLines={1}>{time}</Text>
              </View>
            );

            if (row.taken) {
              // A plain View has no onPress, so a tap does nothing. aria-disabled tells screen readers.
              return (
                <View key={row.startsAt} style={s.row}>
                  {timeCell}
                  <View testID={`booking-taken-${row.time}`} aria-disabled={true} style={[s.cell, { backgroundColor: CAL.taken }]}>
                    <Text style={s.takenText}>{t('booking:taken')}</Text>
                  </View>
                </View>
              );
            }

            const on = selectedSlot?.startsAt === row.startsAt;
            return (
              <View key={row.startsAt} style={s.row}>
                {timeCell}
                <Pressable
                  testID={`booking-slot-${row.time}`}
                  // Radio role + aria-checked: screen readers announce the chosen time as selected.
                  role="radio"
                  aria-checked={on}
                  onPress={() => onSelectSlot(row)}
                  // hovered (web only): stronger tint. Selected = solid accent.
                  style={({ hovered }) => [
                    s.cell,
                    { backgroundColor: on ? accent : hovered ? tint(accent, 0.32) : tint(accent, 0.17) },
                  ]}
                >
                  <Text style={[s.freeText, { color: on ? '#FFFFFF' : accent }]}>
                    {on ? t('booking:yourTime') : t('booking:available')}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </CalendarCard>
  );
}

const s = StyleSheet.create({
  grid:      { backgroundColor: CAL.line, borderWidth: 1, borderColor: CAL.line, borderRadius: 10, overflow: 'hidden', gap: 1 },
  row:       { flexDirection: 'row', gap: 1 },
  timeCol:   { width: 64, height: ROW_HEIGHT, backgroundColor: CAL.band, justifyContent: 'center', paddingHorizontal: 6 },
  timeLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  // The single day column fills the rest of the row; its text sits at the start side.
  cell:      { flex: 1, minWidth: 0, height: ROW_HEIGHT, backgroundColor: C.card, justifyContent: 'center', paddingHorizontal: 14, alignItems: 'flex-start' },
  freeText:  { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  takenText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  closed:    { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', paddingVertical: 20 },
});
