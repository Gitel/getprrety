// Month view: a month card (title + arrows, weekday row, date grid, legend) and, under it,
// the day schedule of the focused date.
//
// Date cell kinds:
//   available -> accent dot, tappable radio            (testID booking-day-<date>)
//   full      -> grey dot, tappable (shows its taken times)  (booking-day-full-<date>)
//   off       -> faded, NOT tappable: no entry, before range.min or after range.max
//                                                      (booking-day-off-<date>)
// Today has a thin accent ring; the focused date is a filled accent circle.
//
// RTL: the grid rows are plain flex rows, so the browser mirrors them under dir="rtl"
// (Sunday ends up on the right, as in a Hebrew calendar).
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { weekdayNames, monthNames } from '../../lib/formatting';
import { isRTL } from '../../lib/language';
import { formatSlotDay } from '../../lib/bookingApi';
import { dayStatus, monthGrid, clampDate } from '../../lib/bookingCalendar';
import DaySchedule from './DaySchedule';
import NavHeader from './NavHeader';

// '2026-10-19' -> [2026, 10]
const yearMonth = (date) => [Number(date.slice(0, 4)), Number(date.slice(5, 7))];

// Where focus goes when the user changes month: the first AVAILABLE date of that month inside
// the range; if there is none, the first date of that month inside the range.
function focusForMonth(year, month, index, range) {
  const dates = monthGrid(year, month).flat().filter((d) => d && d >= range.min && d <= range.max);
  if (dates.length === 0) return clampDate(monthGrid(year, month).flat().find(Boolean), range);
  return dates.find((d) => dayStatus(index, d) === 'available') || dates[0];
}

export default function MonthView({
  index, today, range, focusDate, onFocusDate, selectedSlot, onSelectSlot, accent, lang,
}) {
  const { t } = useTranslation();
  const rtl = isRTL(lang);
  const shown = focusDate || today;
  const [year, month] = yearMonth(shown);

  // Arrows are disabled when the neighbouring month is entirely outside the range.
  const prevDisabled = shown.slice(0, 7) <= range.min.slice(0, 7);
  const nextDisabled = shown.slice(0, 7) >= range.max.slice(0, 7);
  const goMonth = (delta) => {
    const dt = new Date(Date.UTC(year, month - 1 + delta, 1));
    onFocusDate(focusForMonth(dt.getUTCFullYear(), dt.getUTCMonth() + 1, index, range));
  };

  const title = `${monthNames(lang)[month - 1]} ${year}`;
  const weekdays = weekdayNames(lang);

  return (
    <View>
      <View style={s.card}>
        <NavHeader
          lang={lang}
          // Isolate marks keep the year next to the Hebrew month name in the right order.
          title={rtl ? `\u2068${title}\u2069` : title}
          titleTestID="booking-month-label"
          prevTestID="booking-month-prev"
          nextTestID="booking-month-next"
          prevLabel={t('booking:prevMonth')}
          nextLabel={t('booking:nextMonth')}
          prevDisabled={prevDisabled}
          nextDisabled={nextDisabled}
          onPrev={() => goMonth(-1)}
          onNext={() => goMonth(1)}
        />

        <View style={s.weekRow}>
          {weekdays.map((name, i) => (
            <Text key={i} style={s.weekday} numberOfLines={1}>{name}</Text>
          ))}
        </View>

        {/* radiogroup + label: a screen reader treats the date cells as one group */}
        <View role="radiogroup" aria-label={t('booking:pickDay')}>
        {monthGrid(year, month).map((week, wi) => (
          <View key={wi} style={s.weekRow}>
            {week.map((date, di) => {
              // Padding cell before the 1st / after the last day of the month.
              if (!date) return <View key={`pad-${di}`} style={s.cell} />;

              const inRange = date >= range.min && date <= range.max;
              const status = inRange ? dayStatus(index, date) : 'none';
              const isToday = date === today;
              const on = date === focusDate;
              const dayNumber = Number(date.slice(8));

              if (status === 'none') {
                // Faded and not pressable at all (a View has no onPress).
                return (
                  <View key={date} style={s.cell}>
                    <View testID={`booking-day-off-${date}`} style={[s.circle, isToday && { borderColor: accent }]}>
                      <Text style={[s.dayText, s.dayTextOff]}>{dayNumber}</Text>
                    </View>
                  </View>
                );
              }

              const isFull = status === 'full';
              return (
                <View key={date} style={s.cell}>
                  <Pressable
                    testID={isFull ? `booking-day-full-${date}` : `booking-day-${date}`}
                    // Radio role + aria-checked: screen readers announce the chosen day as selected.
                    role="radio"
                    aria-checked={on}
                    aria-label={isFull ? `${formatSlotDay(date, lang)}, ${t('booking:legendFull')}` : formatSlotDay(date, lang)}
                    onPress={() => onFocusDate(date)}
                    style={[
                      s.circle,
                      isToday && { borderColor: accent },
                      on && { backgroundColor: accent, borderColor: accent },
                    ]}
                  >
                    <Text style={[s.dayText, isFull && !on && s.dayTextFull, on && s.dayTextOn]}>{dayNumber}</Text>
                    <View style={[s.dot, { backgroundColor: on ? '#FFFFFF' : isFull ? C.muted : accent }]} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
        </View>

        <View testID="booking-legend" style={s.legend}>
          <View style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: accent }]} />
            <Text style={s.legendText}>{t('booking:legendAvailable')}</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: C.muted }]} />
            <Text style={s.legendText}>{t('booking:legendFull')}</Text>
          </View>
        </View>
      </View>

      <Text style={s.dayTitle}>{formatSlotDay(shown, lang)}</Text>
      <DaySchedule
        rows={index.get(shown) || []}
        selectedSlot={selectedSlot}
        onSelectSlot={onSelectSlot}
        accent={accent}
        lang={lang}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card:        { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12 },
  weekRow:     { flexDirection: 'row' },
  weekday:     { flex: 1, textAlign: 'center', fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, paddingVertical: 6 },
  // Each cell takes 1/7 of the width; the circle inside is the touch target (44 px tall).
  cell:        { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
  circle:      { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  dayText:     { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text },
  dayTextFull: { color: C.muted },
  dayTextOff:  { color: C.muted, opacity: 0.4 },
  dayTextOn:   { color: '#FFFFFF' },
  dot:         { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  legend:      { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 8, flexWrap: 'wrap' },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  dayTitle:    { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, marginTop: 16, marginBottom: 8 },
});
