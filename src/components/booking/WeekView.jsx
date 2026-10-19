// Week view: 7 day columns (Sunday first) x one row per time that exists in that week.
// Cells are small (about 37 px wide on a phone), so they show a mark, not text; the times are
// written once on the row labels.
//   free cell  -> accent outline (filled when selected), tappable radio
//   taken cell -> grey, NOT pressable
//   no entry   -> empty space
//
// RTL: the rows are plain flex rows, so the browser mirrors them under dir="rtl"
// (the time labels move to the right and Sunday is the first column from the right).
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { weekdayNames, weekdayLetters, monthNames, formatTime } from '../../lib/formatting';
import { isRTL } from '../../lib/language';
import { formatSlotDay } from '../../lib/bookingApi';
import { addDays, clampDate, weekDates, weekTimes } from '../../lib/bookingCalendar';
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
  const shown = focusDate || today;
  const dates = weekDates(shown);
  const times = weekTimes(index, dates);

  // Title: always "<day> <month> - <day> <month>", e.g. "27 Sep - 3 Oct" or "4 Oct - 10 Oct".
  const first = dates[0];
  const last = dates[6];
  const title = `${shortDay(first, lang)} - ${shortDay(last, lang)}`;

  // Arrows move focus by 7 days, never outside the range; disabled when the week already touches the edge.
  const prevDisabled = first <= range.min;
  const nextDisabled = last >= range.max;
  const move = (days) => onFocusDate(clampDate(addDays(shown, days), range));

  const names = rtl ? weekdayLetters(lang) : weekdayNames(lang);

  return (
    <View style={s.card}>
      <NavHeader
        lang={lang}
        title={rtl ? `\u2068${title}\u2069` : title}
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

      {/* Header row: an empty corner above the time labels, then weekday + day number per column. */}
      <View style={s.row}>
        <View style={s.timeCol} />
        {dates.map((date, i) => {
          const hasTimes = (index.get(date) || []).length > 0 && date >= range.min && date <= range.max;
          return (
            <View key={date} style={[s.col, !hasTimes && s.faded]}>
              <Text style={s.weekday} numberOfLines={1}>{names[i]}</Text>
              <Text style={[s.dayNumber, date === today && { color: accent }]}>{Number(date.slice(8))}</Text>
            </View>
          );
        })}
      </View>

      {times.length === 0 ? (
        <Text testID="booking-day-closed" style={s.closed}>{t('booking:closedDay')}</Text>
      ) : (
        <View role="radiogroup" aria-label={t('booking:pickTime')}>
          {times.map((time) => (
            <View key={time} style={s.row}>
              <View style={s.timeCol}>
                <Text style={s.timeLabel} numberOfLines={1}>{formatTime(time, lang)}</Text>
              </View>
              {dates.map((date) => {
                const entry = (index.get(date) || []).find((r) => r.time === time);
                // No entry: keep the column's width with an empty box.
                if (!entry) return <View key={date} style={s.col} />;

                if (entry.taken) {
                  // Plain View = no onPress = cannot be tapped.
                  return (
                    <View key={date} style={s.col}>
                      <View
                        testID={`booking-week-taken-${date}-${time}`}
                        // The cell has no text, so give it a role and a spoken label.
                        role="img"
                        aria-label={`${formatSlotDay(date, lang)}, ${formatTime(time, lang)}, ${t('booking:taken')}`}
                        aria-disabled={true}
                        style={[s.cell, s.cellTaken]}
                      />
                    </View>
                  );
                }

                const on = selectedSlot?.startsAt === entry.startsAt;
                return (
                  <View key={date} style={s.col}>
                    <Pressable
                      testID={`booking-week-cell-${date}-${time}`}
                      // Radio role + aria-checked: screen readers announce the chosen time as selected.
                      role="radio"
                      aria-checked={on}
                      aria-label={`${formatSlotDay(date, lang)}, ${formatTime(time, lang)}`}
                      onPress={() => onSelectSlot(entry)}
                      style={[s.cell, { borderColor: accent }, on && { backgroundColor: accent }]}
                    >
                      <View style={[s.mark, { backgroundColor: on ? '#FFFFFF' : accent }]} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {/* Legend: outlined swatch = free, grey swatch = taken (same look as the Month legend). */}
      <View testID="booking-week-legend" style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.swatch, { borderColor: accent }]} />
          <Text style={s.legendText}>{t('booking:available')}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.swatch, s.cellTaken]} />
          <Text style={s.legendText}>{t('booking:taken')}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card:      { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12 },
  row:       { flexDirection: 'row', alignItems: 'center' },
  // Fixed-width column for the time labels; the 7 day columns share the rest equally.
  timeCol:   { width: 58, justifyContent: 'center' },
  timeLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  col:       { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  faded:     { opacity: 0.35 },
  weekday:   { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted },
  dayNumber: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 4 },
  // The cell fills the column width (minus 2 px gaps) and is 40 px tall.
  cell:      { width: '92%', height: 40, borderRadius: 8, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  cellTaken: { backgroundColor: C.border },
  mark:      { width: 8, height: 8, borderRadius: 4 },
  legend:     { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 8, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  swatch:     { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: 'transparent' },
  closed:    { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', paddingVertical: 20 },
});
