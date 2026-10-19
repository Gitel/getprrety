// Month view: one calendar card with the month title + arrows, a weekday band, a real 7 x N grid
// with divider lines, and a legend. The times of a day are NOT listed here: pressing a day cell
// calls onOpenDay(date) and the screen opens the day pop-up (DayTimesModal).
//
// Date cell kinds:
//   available -> accent "N free" text (wide) / accent dot (phone), hover tint, tappable radio
//                                                       (testID booking-day-<date>)
//   full      -> muted "Full" text (wide) / grey dot (phone), tappable (pop-up shows taken times)
//                                                       (booking-day-full-<date>)
//   off       -> soft background, faded number, NOT tappable: no entry, before range.min,
//                after range.max, or padding before the 1st / after the last day
//                                                       (booking-day-off-<date>)
// Today's number sits in a thin accent circle. The day that holds the chosen slot gets a 2 px
// accent inner border.
//
// RTL: rows are plain flex rows, so the browser mirrors them under dir="rtl"
// (Sunday ends up on the right, as in a Hebrew calendar).
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { weekdayNames, monthNames } from '../../lib/formatting';
import { isRTL } from '../../lib/language';
import { formatSlotDay } from '../../lib/bookingApi';
import { dayStatus, monthGrid, clampDate } from '../../lib/bookingCalendar';
import { CAL, tint, useIsWide } from './calendarTheme';
import CalendarCard from './CalendarCard';
import NavHeader from './NavHeader';

// '2026-10-19' -> [2026, 10]
const yearMonth = (date) => [Number(date.slice(0, 4)), Number(date.slice(5, 7))];

// Where focus goes when the user changes month: the first AVAILABLE date of that month inside
// the range; if there is none, the first date of that month inside the range.
function focusForMonth(year, month, index, range) {
  const dates = monthGrid(year, month).flat().filter((d) => d && d >= range.min && d <= range.max);
  if (dates.length === 0) return clampDate(monthGrid(year, month).flat().find(Boolean), range);
  return dates.find((d) => dayStatus(index, d) === 'available') || dates.find(Boolean);
}

export default function MonthView({
  index, today, range, focusDate, onFocusDate, onOpenDay, selectedSlot, accent, lang,
}) {
  const { t } = useTranslation();
  const rtl = isRTL(lang);
  const wide = useIsWide();
  const shown = focusDate || today;
  const [year, month] = yearMonth(shown);
  const cellHeight = wide ? 88 : 56; // taller cells on a desktop so the grid looks like a real calendar

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
    <CalendarCard>
      <NavHeader
        lang={lang}
        // Isolate marks keep the year next to the Hebrew month name in the right order.
        title={rtl ? `⁨${title}⁩` : title}
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

      {/* The grid box: its background is the divider-line colour and the 1 px gaps between rows
          and cells let it show through, which draws the lines. */}
      <View style={s.grid}>
        <View style={s.band}>
          {weekdays.map((name, i) => (
            <Text key={i} style={s.weekday} numberOfLines={1}>{name}</Text>
          ))}
        </View>

        {/* radiogroup + label: a screen reader treats the date cells as one group */}
        <View role="radiogroup" aria-label={t('booking:pickDay')} style={s.rows}>
          {monthGrid(year, month).map((week, wi) => (
            <View key={wi} style={s.weekRow}>
              {week.map((date, di) => {
                // Padding cell before the 1st / after the last day of the month.
                if (!date) return <View key={`pad-${di}`} style={[s.cell, s.cellOff, { height: cellHeight }]} />;

                const inRange = date >= range.min && date <= range.max;
                const status = inRange ? dayStatus(index, date) : 'none';
                const isToday = date === today;
                const hasChosen = selectedSlot?.date === date;
                const dayNumber = Number(date.slice(8));
                const number = (
                  <View style={[s.numberWrap, isToday && { borderColor: accent }]}>
                    <Text style={[s.number, status === 'none' && s.numberOff, status === 'full' && s.numberFull]}>
                      {dayNumber}
                    </Text>
                  </View>
                );

                if (status === 'none') {
                  // Soft background, not pressable at all (a View has no onPress).
                  return (
                    <View key={date} testID={`booking-day-off-${date}`} style={[s.cell, s.cellOff, { height: cellHeight }]}>
                      {number}
                    </View>
                  );
                }

                const isFull = status === 'full';
                return (
                  <Pressable
                    key={date}
                    testID={isFull ? `booking-day-full-${date}` : `booking-day-${date}`}
                    // Radio role + aria-checked: screen readers announce the focused day as selected.
                    role="radio"
                    aria-checked={date === focusDate}
                    aria-label={isFull ? `${formatSlotDay(date, lang)}, ${t('booking:legendFull')}` : formatSlotDay(date, lang)}
                    onPress={() => onOpenDay(date)}
                    // hovered (web): free days get a ~10 % accent tint, full days a neutral one.
                    style={({ hovered }) => [
                      s.cell,
                      { height: cellHeight },
                      hovered && { backgroundColor: isFull ? CAL.off : tint(accent, 0.1) },
                    ]}
                  >
                    {number}
                    {/* Wide: a short text under the number. Phone: only a small dot. */}
                    {wide ? (
                      <Text style={[s.cellText, { color: isFull ? C.muted : accent }]} numberOfLines={1}>
                        {isFull ? t('booking:full') : t('booking:freeCount', { count: (index.get(date) || []).filter((r) => !r.taken).length })}
                      </Text>
                    ) : (
                      <View style={[s.dot, { backgroundColor: isFull ? C.muted : accent }]} />
                    )}
                    {hasChosen && <View pointerEvents="none" style={[s.chosen, { borderColor: accent }]} />}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      <View testID="booking-legend" style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: accent }]} />
          <Text style={s.legendText}>{t('booking:legendAvailable')}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: C.muted }]} />
          <Text style={s.legendText}>{t('booking:legendFull')}</Text>
        </View>
      </View>
    </CalendarCard>
  );
}

const s = StyleSheet.create({
  grid:        { backgroundColor: CAL.line, borderWidth: 1, borderColor: CAL.line, borderRadius: 10, overflow: 'hidden' },
  band:        { flexDirection: 'row', backgroundColor: CAL.band, marginBottom: 1 },
  weekday:     { flex: 1, textAlign: 'center', fontFamily: 'DMSans_500Medium', fontSize: 11, color: C.muted, paddingVertical: 8 },
  rows:        { gap: 1 },
  weekRow:     { flexDirection: 'row', gap: 1 },
  // Each cell takes 1/7 of the width (flex:1 + minWidth:0 so a long text never widens one column).
  cell:        { flex: 1, minWidth: 0, backgroundColor: C.card, padding: 6, alignItems: 'flex-start' },
  cellOff:     { backgroundColor: CAL.off },
  // The day number sits at the start-top corner; today's number gets a thin accent circle.
  numberWrap:  { minWidth: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  number:      { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text },
  numberFull:  { color: C.muted },
  numberOff:   { color: C.muted, opacity: 0.45 },
  cellText:    { fontFamily: 'DMSans_500Medium', fontSize: 11, marginTop: 'auto' },
  dot:         { width: 6, height: 6, borderRadius: 3, marginTop: 'auto', marginStart: 10 },
  legendDot:   { width: 6, height: 6, borderRadius: 3 },
  // 2 px accent inner border on the day that holds the chosen time.
  chosen:      { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2 },
  legend:      { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 12, flexWrap: 'wrap' },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
});
