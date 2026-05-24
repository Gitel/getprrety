import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView,
  StyleSheet, Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { C, QUESTIONS, SKIN_TONES } from '../constants';
import { useApp } from '../context/AppContext';

const TOTAL = QUESTIONS.length;

export default function QuizScreen({ navigation }) {
  const { setAnswers: saveAnswers } = useApp();
  const [idx, setIdx]       = useState(0);
  const [answers, setAns]   = useState({});
  const [sel, setSel]       = useState(null);
  const [multi, setMulti]   = useState([]);
  const fadeAnim            = useRef(new Animated.Value(1)).current;
  const q                   = QUESTIONS[idx];
  const isLast              = idx === TOTAL - 1;

  useEffect(() => {
    if (q.type === 'multi') setMulti(answers[q.id] || []);
    else setSel(answers[q.id] || null);
  }, [idx]);

  const canNext = q.type === 'multi'
    ? multi.length > 0
    : (q.type === 'photos' || q.type === 'textarea') ? true : !!sel;

  function next() {
    const a = { ...answers };
    if (q.type === 'multi') a[q.id] = multi;
    else if (q.type !== 'photos' && q.type !== 'textarea') a[q.id] = sel;
    setAns(a);
    if (isLast) {
      saveAnswers(a);
      navigation.navigate('Loading');
      return;
    }
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    setTimeout(() => { setIdx(i => i + 1); }, 120);
  }

  const toggleMulti = v =>
    setMulti(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  async function pickPhoto(key) {
    const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!res.granted) {
      Alert.alert('Permission needed', 'Enable photo library access in Settings to upload photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled) {
      setAns(a => ({ ...a, [key]: result.assets[0].uri }));
    }
  }

  async function takePhoto(key) {
    const res = await ImagePicker.requestCameraPermissionsAsync();
    if (!res.granted) {
      Alert.alert('Permission needed', 'Enable camera access in Settings to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.7,
    });
    if (!result.canceled) {
      setAns(a => ({ ...a, [key]: result.assets[0].uri }));
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.logo}>Get Pretty</Text>
        <Text style={s.counter}>{idx + 1} / {TOTAL}</Text>
      </View>
      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${(idx / TOTAL) * 100}%` }]} />
      </View>

      <Animated.ScrollView style={[s.scroll, { opacity: fadeAnim }]} contentContainerStyle={s.content}>
        {q.section && (
          <View style={s.sectionBlock}>
            <Text style={s.sectionLabel}>{q.section}</Text>
            {q.sectionSub && <Text style={s.sectionSub}>{q.sectionSub}</Text>}
          </View>
        )}
        <Text style={s.emoji}>{q.emoji}</Text>
        <Text style={s.question}>{q.question}</Text>
        {q.hint && <Text style={s.hint}>{q.hint}</Text>}

        {/* SINGLE SELECT */}
        {q.type === 'single' && (
          <>
            {q.options.map(o => (
              <Pressable
                key={o.value}
                onPress={() => setSel(o.value)}
                style={[s.optionCard, sel === o.value && s.optionCardSelected]}
              >
                <View>
                  <Text style={[s.optionLabel, sel === o.value && s.optionLabelSelected]}>{o.label}</Text>
                  {o.sub && <Text style={s.optionSub}>{o.sub}</Text>}
                </View>
                {sel === o.value && <Text style={s.check}>✓</Text>}
              </Pressable>
            ))}
            <Btn onPress={next} disabled={!sel} label={isLast ? 'Create My Profile →' : 'Continue →'} />
            <Text style={s.footnote}>No wrong answers. Your skin has no judgment.</Text>
          </>
        )}

        {/* SKIN TONE */}
        {q.type === 'tone' && (
          <>
            <View style={s.toneGrid}>
              {SKIN_TONES.map(t => (
                <Pressable
                  key={t.value}
                  onPress={() => setSel(t.value)}
                  style={[s.toneCard, sel === t.value && { borderColor: C.accent, backgroundColor: C.accentLight }]}
                >
                  <View style={[s.toneSwatch, { backgroundColor: t.swatch }]} />
                  <Text style={[s.toneLabel, sel === t.value && { color: C.accent }]}>{t.label}</Text>
                  <Text style={s.toneSub}>{t.sub}</Text>
                </Pressable>
              ))}
            </View>
            <Btn onPress={next} disabled={!sel} label="Continue →" />
          </>
        )}

        {/* MULTI SELECT */}
        {q.type === 'multi' && (
          <>
            <View style={s.chipRow}>
              {q.options.map(o => {
                const active = multi.includes(o.value);
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => toggleMulti(o.value)}
                    style={[s.chip, active && s.chipActive]}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>{o.label}</Text>
                    {o.sub && <Text style={[s.chipSub, active && { color: 'rgba(255,255,255,0.75)' }]}>{o.sub}</Text>}
                  </Pressable>
                );
              })}
            </View>
            <Btn onPress={next} disabled={multi.length === 0} label="Continue →" />
          </>
        )}

        {/* PHOTOS */}
        {q.type === 'photos' && (
          <>
            {[
              { label: 'Right side of face', hint: 'Turn your right cheek toward the light', k: 'photo_right' },
              { label: 'Left side of face',  hint: 'Turn your left cheek toward the light',  k: 'photo_left' },
              { label: 'Straight on',        hint: 'Face forward, chin slightly down',        k: 'photo_front' },
            ].map(p => {
              const done = !!answers[p.k];
              return (
                <View key={p.k} style={[s.photoCard, done && s.photoCardDone]}>
                  <View style={s.photoCardInner}>
                    <View style={[s.photoIcon, done && s.photoIconDone]}>
                      <Text style={{ fontSize: done ? 12 : 15, color: done ? '#7A9E6E' : C.muted }}>{done ? '✓' : '🤳'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.photoLabel, done && { color: '#7A9E6E' }]}>{p.label}</Text>
                      <Text style={s.photoHint}>{done ? 'Photo added ✓' : p.hint}</Text>
                    </View>
                  </View>
                  {!done ? (
                    <View style={s.photoActions}>
                      <Pressable style={s.photoBtn} onPress={() => takePhoto(p.k)}>
                        <Text style={s.photoBtnText}>📷 Take photo</Text>
                      </Pressable>
                      <View style={s.photoDivider} />
                      <Pressable style={s.photoBtn} onPress={() => pickPhoto(p.k)}>
                        <Text style={s.photoBtnText}>🖼 Upload</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => setAns(a => { const n = { ...a }; delete n[p.k]; return n; })}>
                      <Text style={s.retake}>Remove & retake</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Btn
              onPress={next}
              accent
              label={Object.keys(answers).some(k => k.startsWith('photo_')) ? 'Continue →' : 'Skip for now →'}
            />
            <Text style={s.footnote}>We see skin texture, not judgment</Text>
          </>
        )}

        {/* TEXTAREA */}
        {q.type === 'textarea' && (
          <>
            <TextInput
              multiline
              numberOfLines={4}
              placeholder={q.placeholder}
              placeholderTextColor={C.muted}
              value={answers[q.id] || ''}
              onChangeText={t => setAns(a => ({ ...a, [q.id]: t }))}
              style={s.textarea}
            />
            <Text style={s.shelfLabel}>Drop pics of your shelf <Text style={{ fontStyle: 'italic' }}>· optional, up to 5</Text></Text>
            <Text style={s.shelfSub}>We're curious, not judgy</Text>
            <View style={s.shelfGrid}>
              {Array.from({ length: 5 }).map((_, i) => {
                const shelf = answers.shelf_photos || [];
                const filled = i < shelf.length;
                const isNext = i === shelf.length && shelf.length < 5;
                if (filled) return (
                  <View key={i} style={[s.shelfSlot, s.shelfSlotFilled]}>
                    <Text style={{ fontSize: 22 }}>🧴</Text>
                    <Text style={s.shelfAdded}>Added</Text>
                    <Pressable
                      style={s.shelfRemove}
                      onPress={() => setAns(a => ({ ...a, shelf_photos: (a.shelf_photos || []).filter((_, j) => j !== i) }))}
                    >
                      <Text style={{ fontSize: 13, color: C.muted }}>✕</Text>
                    </Pressable>
                  </View>
                );
                if (isNext) return (
                  <View key={i} style={s.shelfSlotNext}>
                    <Pressable
                      style={s.shelfAdd}
                      onPress={async () => {
                        const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                        if (!result.canceled) setAns(a => ({ ...a, shelf_photos: [...(a.shelf_photos || []), result.assets[0].uri] }));
                      }}
                    >
                      <Text style={s.shelfAddText}>📷</Text>
                    </Pressable>
                    <Pressable
                      style={s.shelfAdd}
                      onPress={async () => {
                        const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
                        if (!result.canceled) setAns(a => ({ ...a, shelf_photos: [...(a.shelf_photos || []), result.assets[0].uri] }));
                      }}
                    >
                      <Text style={s.shelfAddText}>🖼</Text>
                    </Pressable>
                  </View>
                );
                return <View key={i} style={s.shelfSlotEmpty} />;
              })}
            </View>
            <Btn onPress={next} accent label="Create My Skin Profile →" />
          </>
        )}

        <View style={{ height: 40 }} />
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

function Btn({ onPress, disabled, label, accent }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        accent && { backgroundColor: C.accent },
        disabled && s.btnDisabled,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 14 },
  logo:        { fontFamily: 'CormorantGaramond_500Medium', fontSize: 20, color: C.text, letterSpacing: 2 },
  counter:     { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  progressTrack: { height: 2, backgroundColor: C.border, marginHorizontal: 24 },
  progressFill:  { height: 2, backgroundColor: C.accent, borderRadius: 1 },
  scroll:      { flex: 1 },
  content:     { padding: 24 },
  sectionBlock:{ marginBottom: 18 },
  sectionLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 2 },
  sectionSub:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic' },
  emoji:       { fontSize: 38, marginBottom: 14 },
  question:    { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.text, lineHeight: 32, marginBottom: 4 },
  hint:        { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 20, lineHeight: 19 },

  optionCard:         { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  optionCardSelected: { backgroundColor: C.accentLight, borderColor: C.accent },
  optionLabel:        { fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#4A4039' },
  optionLabelSelected:{ fontFamily: 'DMSans_500Medium', color: C.accent },
  optionSub:          { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  check:              { color: C.accent, fontWeight: '700', fontSize: 16 },

  toneGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  toneCard:   { width: '47%', borderRadius: 13, padding: 14, backgroundColor: C.card, borderWidth: 2, borderColor: C.border, gap: 8 },
  toneSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(0,0,0,0.08)' },
  toneLabel:  { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, marginBottom: 1 },
  toneSub:    { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, lineHeight: 14 },

  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 24 },
  chip:         { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 22, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  chipActive:   { backgroundColor: C.accent, borderColor: C.accent },
  chipText:     { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#4A4039' },
  chipTextActive:{ fontFamily: 'DMSans_500Medium', color: '#FFF' },
  chipSub:      { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted },

  photoCard:      { borderRadius: 13, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, marginBottom: 12, overflow: 'hidden' },
  photoCardDone:  { borderColor: '#7A9E6E', backgroundColor: '#F2F6EF' },
  photoCardInner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  photoIcon:      { width: 36, height: 36, borderRadius: 8, backgroundColor: '#F0EBE5', borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  photoIconDone:  { backgroundColor: '#7A9E6E25', borderColor: '#7A9E6E' },
  photoLabel:     { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 1 },
  photoHint:      { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  photoActions:   { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
  photoBtn:       { flex: 1, padding: 10, alignItems: 'center' },
  photoBtnText:   { fontFamily: 'DMSans_500Medium', fontSize: 12, color: C.accent },
  photoDivider:   { width: 1, backgroundColor: C.border },
  retake:         { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', padding: 8 },

  textarea:   { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, padding: 14, fontFamily: 'CormorantGaramond_400Regular', fontSize: 14, color: C.text, lineHeight: 23, marginBottom: 16, textAlignVertical: 'top', minHeight: 110 },
  shelfLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, marginBottom: 3 },
  shelfSub:   { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, fontStyle: 'italic', marginBottom: 12 },
  shelfGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  shelfSlot:  { width: '30%', aspectRatio: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  shelfSlotFilled: { backgroundColor: '#7A9E6E20', borderWidth: 1.5, borderColor: '#7A9E6E50' },
  shelfSlotNext:   { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, overflow: 'hidden' },
  shelfSlotEmpty:  { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#F9F7F4', alignItems: 'center', justifyContent: 'center' },
  shelfAdded: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: '#7A9E6E' },
  shelfRemove:{ position: 'absolute', top: 4, right: 6 },
  shelfAdd:   { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: C.border },
  shelfAddText:{ fontSize: 18 },

  btn:         { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 16 },
  btnDisabled: { backgroundColor: '#D4CBC4' },
  btnText:     { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  footnote:    { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', fontStyle: 'italic' },
});
