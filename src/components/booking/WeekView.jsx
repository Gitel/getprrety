// Week view: a real time grid. First column = the times, then 7 day columns (Sunday first), one
// row per time that exists in that week. 1 px divider lines between every row and column.
//   free cell     -> ~8 % accent tint; hover = ~22 % tint and (wide only) shows its time; tappable radio
//   taken cell    -> grey, "Taken" text on wide screens, NOT pressable
//   selected cell -> accent fill with the white time (phone: a white dot, the cell is too narrow for text)
//   no entry      -> plain white
// Closed day columns have a faded header.
//
// RTL: the rows are plain flex rows, so the browser mirrors them under dir="rtl"
// (the time column moves to the right and Sunday is the first day column from the right).
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { weekdayNames, weekdayLetters, monthNames, formatTime } from '../../lib/formatting';
import { isRTL } from '../../lib/language';
import { formatSlotDay } from '../../lib/bookingApi';
import { addDays, clampDate, weekDates, weekTimes } from '../../lib/bookingCalendar';
import { CAL, tint, useIsWide } from './calendarTheme';
import CalendarCard from './CalendarCard';
import NavHeader from './NavHeader';

// '2026-09-27' -> '27 Sep' (he: full Hebrew month name).
function shortDay(date, lang) {
  const name = monthNames(lang)[Number(date.slice(5, 7)) - 1];
  return `${Number(date.slice(8))} ${isRTL(lang) ? name : name.slice(0, 3)}`;
}

export default function WeekView({
  index, today, range, focusDate, onFocusDate, selectedSlot, onSelectSlot, accent, lang,
}) {
  const { t } = useTranslation();
  const rtl = isRTL(lang);
  const wide = useIsWide();
  const shown = focusDate || today;
  const dates = weekDates(shown);
  const times = weekTimes(index, dates);
  const rowHeight = wide ? 40 : 36;

  // Title: always "<day> <month> - <day> <month>", e.g. "27 Sep - 3 Oct" or "4 Oct - 10 Oct".
  const first = dates[0];
  const last = dates[6];
  const title = `${shortDay(first, lang)} - ${shortDay(last, lang)}`;

  // Arrows move focus by 7 days, never outside the range; disabled when the week already touches the edge.
  const prevDisabled = first <= range.min;
  const nextDisabled = last >= range.max;
  const move = (days) => onFocusDate(clampDate(addDays(shown, days), range));

  const names = rtl || !wide ? weekdayLetters(lang) : weekdayNames(lang);

  return (
    <CalendarCard>
      <NavHeader
        lang={lang}
        title={rtl ? `⁨${title}⁩` : title}
        titleTestID="booking-week-label"
        prevTestID="booking-week-prev"
        nextTestID="booking-week-next"
        prevLabel={t('booking:prevWeek')}
        nextLabel={t('booking:nextWeek')}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
        onPrev={() => move(-7)}
        onNext={() => move(7)}
      />

      {/* Grid box: the background is the line colour, the 1 px gaps between rows/cells draw the lines. */}
      <View style={s.grid}>
        {/* Header band: an empty corner above the time column, then weekday + day number per column. */}
        <View style={[s.row, s.band]}>
          <View style={s.timeCol} />
          {dates.map((date, i) => {
            const hasTimes = (index.get(date) || []).length > 0 && date >= range.min && date <= range.max;
            const isToday = date === today;
            return (
              <View key={date} style={[s.headCell, !hasTimes && s.faded]}>
                <Text style={s.weekday} numberOfLines={1}>{names[i]}</Text>
                <View style={[s.numberWrap, isToday && { borderColor: accent }]}>
                  <Text style={[s.dayNumber, isToday && { color: accent }]}>{Number(date.slice(8))}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {times.length === 0 ? (
          <Text testID="booking-day-closed" style={s.closed}>{t('booking:closedDay')}</Text>
        ) : (
          <View role="radiogroup" aria-label={t('booking:pickTime')} style={s.rows}>
            {times.map((time) => (
              <View key={time} style={s.row}>
                <View testID={`booking-week-time-${time}`} style={[s.timeCol, s.timeCell, { height: rowHeight }]}>
                  <Text style={s.timeLabel} numberOfLines={1}>{formatTime(time, lang)}</Text>
                </View>
                {dates.map((date) => {
                  const entry = (index.get(date) || []).find((r) => r.time === time);
                  // No entry: a plain white cell keeps the column (and its divider lines).
                  if (!entry) return <View key={date} style={[s.cell, { height: rowHeight }]} />;

                  const label = `${formatSlotDay(date, lang)}, ${formatTime(time, lang)}`;
                  if (entry.taken) {
                    // Plain View = no onPress = cannot be tapped.
                    return (
                      <View
                        key={date}
                        testID={`booking-week-taken-${date}-${time}`}
                        // Give the cell a role and a spoken label (on phones it has no text).
                        role="img"
                        aria-label={`${label}, ${t('booking:taken')}`}
                        aria-disabled={true}
                        style={[s.cell, s.cellTaken, { height: rowHeight }]}
                      >
                        {wide && <Text style={s.takenText}>{t('booking:taken')}</Text>}
                      </View>
                    );
                  }

                  const on = selectedSlot?.startsAt === entry.startsAt;
                  return (
                    <Pressable
                      key={date}
                      testID={`booking-week-cell-${date}-${time}`}
                      // Radio role + aria-checked: screen readers announce the chosen time as selected.
                      role="radio"
                      aria-checked={on}
                      aria-label={label}
                      onPress={() => onSelectSlot(entry)}
                      // hovered (web only): stronger tint, and the time text appears (below).
                      style={({ hovered }) => [
                        s.cell,
                        { height: rowHeight, backgroundColor: on ? accent : hovered ? tint(accent, 0.22) : tint(accent, 0.08) },
                      ]}
                    >
                      {({ hovered }) => (
                        wide && (hovered || on)
                          ? <Text style={[s.cellTime, { color: on ? '#FFFFFF' : accent }]} numberOfLines={1}>{formatTime(time, lang)}</Text>
                          : on ? <View style={s.whiteDot} /> : null
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Legend: tinted swatch = free, grey swatch = taken. */}
      <View testID="booking-week-legend" style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.swatch, { backgroundColor: tint(accent, 0.22), borderColor: accent }]} />
          <Text style={s.legendText}>{t('booking:available')}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.swatch, { backgroundColor: CAL.taken, borderColor: CAL.taken }]} />
          <Text style={s.legendText}>{t('booking:taken')}</Text>
        </View>
      </View>
    </CalendarCard>
  );
}

const s = StyleSheet.create({
  grid:      { backgroundColor: CAL.line, borderWidth: 1, borderColor: CAL.line, borderRadius: 10, overflow: 'hidden' },
  rows:      { gap: 1 },
  row:       { flexDirection: 'row', gap: 1 },
  band:      { backgroundColor: CAL.band, marginBottom: 1 },
  // Fixed-width column for the time labels; the 7 day columns share the rest equally.
  timeCol:   { width: 64, backgroundColor: CAL.band },
  timeCell:  { justifyContent: 'center', paddingHorizontal: 6 },
  timeLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  headCell:  { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, backgroundColor: CAL.band },
  faded:     { opacity: 0.4 },
  weekday:   { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  numberWrap:{ minWidth: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  dayNumber: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text },
  // Every day cell shares the row equally; minWidth 0 keeps the 7 columns the same width.
  cell:      { flex: 1, minWidth: 0, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  cellTaken: { backgroundColor: CAL.taken },
  takenText: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  cellTime:  { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  whiteDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  legend:     { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  swatch:     { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  closed:    { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', paddingVertical: 20, backgroundColor: C.card },
});
