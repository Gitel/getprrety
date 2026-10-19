// Title with a "previous" and a "next" arrow, shared by the Month, Week and Day views.
//
// RTL (Hebrew): the page sets dir="rtl" on <html>, so this flex row is mirrored by the browser
// (the previous arrow ends up on the right). Only the arrow GLYPHS need flipping by hand: in
// Hebrew "previous" points right and "next" points left.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C } from '../../constants';
import { isRTL } from '../../lib/language';

function Arrow({ glyph, testID, label, disabled, onPress }) {
  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label={label}
      // Pressable's disabled prop makes react-native-web render aria-disabled="true" (and the native disabled flag), so it cannot be tapped.
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      // hovered (web): a soft tint behind the arrow so it feels clickable.
      style={({ hovered }) => [s.arrow, hovered && !disabled && s.arrowHover, disabled && s.arrowOff]}
    >
      <Text style={s.glyph}>{glyph}</Text>
    </Pressable>
  );
}

export default function NavHeader({
  lang, title, titleTestID, prevTestID, nextTestID, prevLabel, nextLabel,
  prevDisabled, nextDisabled, onPrev, onNext,
}) {
  const rtl = isRTL(lang);
  return (
    <View style={s.row}>
      <Arrow glyph={rtl ? '›' : '‹'} testID={prevTestID} label={prevLabel} disabled={prevDisabled} onPress={onPrev} />
      <Text testID={titleTestID} style={s.title} aria-live="polite">{title}</Text>
      <Arrow glyph={rtl ? '‹' : '›'} testID={nextTestID} label={nextLabel} disabled={nextDisabled} onPress={onNext} />
    </View>
  );
}

const s = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title:    { flex: 1, textAlign: 'center', fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.text },
  // 44 px square = comfortable touch target.
  arrow:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  arrowHover: { backgroundColor: 'rgba(0,0,0,0.06)' },
  arrowOff: { opacity: 0.25 },
  glyph:    { fontFamily: 'DMSans_500Medium', fontSize: 28, lineHeight: 30, color: C.text },
});
