// Day view: the date as a title with previous/next-day arrows, and one large day schedule.
// Arrows move one calendar day at a time and stop at the edges of the range. A day without
// times is not skipped: DaySchedule shows the "no times on this day" message for it.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { C } from '../../constants';
import { isRTL } from '../../lib/language';
import { formatSlotDay } from '../../lib/bookingApi';
import { addDays } from '../../lib/bookingCalendar';
import DaySchedule from './DaySchedule';
import NavHeader from './NavHeader';

export default function DayView({
  index, today, range, focusDate, onFocusDate, selectedSlot, onSelectSlot, accent, lang,
}) {
  const { t } = useTranslation();
  const shown = focusDate || today;
  const title = formatSlotDay(shown, lang);

  // The caller only needs the new date; we never leave [range.min, range.max].
  const prevDisabled = shown <= range.min;
  const nextDisabled = shown >= range.max;

  return (
    <View style={s.card}>
      <NavHeader
        lang={lang}
        // Isolate marks keep digits and punctuation of the date in order inside Hebrew text.
        title={isRTL(lang) ? `\u2068${title}\u2069` : title}
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
      <DaySchedule
        rows={index.get(shown) || []}
        selectedSlot={selectedSlot}
        onSelectSlot={onSelectSlot}
        accent={accent}
        lang={lang}
        large
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12 },
});
