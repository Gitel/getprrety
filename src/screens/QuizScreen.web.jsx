import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView,
  StyleSheet, Animated, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, QUESTIONS, SKIN_TONES } from '../constants';
import { useApp } from '../context/AppContext';

const TOTAL = QUESTIONS.length;

// ─── Drum Date Picker ────────────────────────────────────────────────────────
const ITEM_H      = 52;
const MONTHS_LIST = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const DAYS_LIST   = Array.from({ length: 31 }, (_, i) => String(i + 1));

function WheelColumn({ data, defaultIdx = 0, onSelect, flex = 1 }) {
  const ref         = useRef(null);
  const [si, setSi] = useState(defaultIdx);

  useEffect(() => {
    setTimeout(() => ref.current?.scrollTo({ y: defaultIdx * ITEM_H, animated: false }), 100);
  }, []);

  function snap(rawY) {
    const i = Math.max(0, Math.min(Math.round(rawY / ITEM_H), data.length - 1));
    ref.current?.scrollTo({ y: i * ITEM_H, animated: true });
    setSi(i);
    onSelect(i);
  }

  return (
    <ScrollView
      ref={ref}
      style={{ flex, height: ITEM_H * 5 }}
      contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate={0.85}
      scrollEventThrottle={16}
      onScroll={e => setSi(e.nativeEvent.contentOffset.y / ITEM_H)}
      onMomentumScrollEnd={e => snap(e.nativeEvent.contentOffset.y)}
      onScrollEndDrag={e => snap(e.nativeEvent.contentOffset.y)}
    >
      {data.map((label, i) => {
        const dist    = Math.abs(i - si);
        const opacity = Math.max(0.12, 1 - dist * 0.38);
        const bold    = dist < 0.6;
        return (
          <Pressable key={i} onPress={() => snap(i * ITEM_H)}
            style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{
              fontFamily: bold ? 'DMSans_500Medium' : 'DMSans_400Regular',
              fontSize: bold ? 21 : 18,
              color: C.text,
              opacity,
            }}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function DrumDatePicker({ value, onChange, yearsFrom = 1924, yearsTo = 2006 }) {
  const YEARS_LIST = Array.from({ length: yearsTo - yearsFrom + 1 }, (_, i) => String(yearsFrom + i));

  const parseVal = () => {
    if (value && value.includes('/')) {
      const [d, m, y] = value.split('/');
      return {
        dayIdx:   Math.max(0, parseInt(d, 10) - 1),
        monthIdx: Math.max(0, parseInt(m, 10) - 1),
        yearIdx:  Math.max(0, YEARS_LIST.indexOf(y?.trim())),
      };
    }
    const midYear = String(yearsFrom + Math.floor((yearsTo - yearsFrom) / 2));
    return { dayIdx: 0, monthIdx: 0, yearIdx: Math.max(0, YEARS_LIST.indexOf(midYear)) };
  };

  const init   = parseVal();
  const idxRef = useRef({ ...init });

  function emit(di, mi, yi) {
    const day   = DAYS_LIST[di]  || '1';
    const month = String(mi + 1).padStart(2, '0');
    const year  = YEARS_LIST[yi] || String(yearsFrom);
    onChange(`${day}/${month}/${year}`);
  }

  useEffect(() => { emit(init.dayIdx, init.monthIdx, init.yearIdx); }, []);

  return (
    <View style={dp.wrap}>
      <View style={dp.band} pointerEvents="none" />
      <WheelColumn data={DAYS_LIST}   defaultIdx={init.dayIdx}
        onSelect={i => { idxRef.current.dayIdx = i;   emit(i, idxRef.current.monthIdx, idxRef.current.yearIdx); }} flex={1} />
      <WheelColumn data={MONTHS_LIST} defaultIdx={init.monthIdx}
        onSelect={i => { idxRef.current.monthIdx = i; emit(idxRef.current.dayIdx, i, idxRef.current.yearIdx); }} flex={2} />
      <WheelColumn data={YEARS_LIST}  defaultIdx={init.yearIdx}
        onSelect={i => { idxRef.current.yearIdx = i;  emit(idxRef.current.dayIdx, idxRef.current.monthIdx, i); }} flex={1.5} />
    </View>
  );
}

const dp = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  band: { position: 'absolute', top: ITEM_H * 2, left: 10, right: 10, height: ITEM_H, backgroundColor: '#EDEBE6', borderRadius: 10 },
});
// ─────────────────────────────────────────────────────────────────────────────

export default function QuizScreen({ navigation }) {
  const { setAnswers: saveAnswers } = useApp();
  const [idx, setIdx]     = useState(0);
  const [answers, setAns] = useState({});
  const [sel, setSel]     = useState(null);
  const [multi, setMulti] = useState([]);
  const fadeAnim          = useRef(new Animated.Value(1)).current;
  const q                 = QUESTIONS[idx];
  const isLast            = idx === TOTAL - 1;

  // Hidden file input refs — all created unconditionally (no hooks in loops)
  const photoInputRefs   = { photo_right: useRef(null), photo_left: useRef(null), photo_front: useRef(null) };
  const photoCaptureRefs = { photo_right: useRef(null), photo_left: useRef(null), photo_front: useRef(null) };
  const shelfInputRefs   = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];
  const shelfCaptureRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];

  useEffect(() => {
    if (q.type === 'multi' || q.type === 'interests') setMulti(answers[q.id] || []);
    else setSel(answers[q.id] || null);
  }, [idx]);

  const canNext = (q.type === 'multi' || q.type === 'interests')
    ? multi.length > 0
    : (q.type === 'photos' || q.type === 'shelf' || q.type === 'textarea' || q.type === 'birthday' ||
       q.type === 'name' || q.type === 'completion' || q.type === 'event_date') ? true : !!sel;

  function next() {
    const a = { ...answers };
    if (q.type === 'multi' || q.type === 'interests') a[q.id] = multi;
    else if (q.type === 'single' || q.type === 'tone' || q.type === 'event') a[q.id] = sel;
    setAns(a);
    if (isLast) {
      saveAnswers(prev => ({ ...(prev || {}), ...a }));
      navigation.navigate('Loading');
      return;
    }
    const nextQ = QUESTIONS[idx + 1];
    const skipEvent    = nextQ?.type === 'event_date' && a.event === 'no_event';
    const skipPregnant = nextQ?.id === 'pregnant' && a.gender === 'he';
    if (skipPregnant) { a.pregnant = 'no'; setAns({ ...a }); }
    const skip = skipEvent || skipPregnant;
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    setTimeout(() => { setIdx(i => i + (skip ? 2 : 1)); }, 120);
  }

  const toggleMulti = v =>
    setMulti(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // Synchronous click — must NOT be async, user gesture scope must be intact
  function pickPhoto(key) { photoInputRefs[key].current.click(); }
  function takePhoto(key) { photoCaptureRefs[key].current.click(); }

  function onFileChange(key, e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // allow re-selecting same file
    const reader = new FileReader();
    reader.onload = ev => setAns(a => ({ ...a, [key]: ev.target.result }));
    reader.readAsDataURL(file);
  }

  function onShelfFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => setAns(a => ({
      ...a,
      shelf_photos: [...(a.shelf_photos || []), ev.target.result],
    }));
    reader.readAsDataURL(file);
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
                      {done
                        ? <Image source={{ uri: answers[p.k] }} style={{ width: 36, height: 36, borderRadius: 6 }} resizeMode="cover" />
                        : <Text style={{ fontSize: 15, color: C.muted }}>🤳</Text>
                      }
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

        {/* SHELF PHOTOS */}
        {q.type === 'shelf' && (
          <>
            <View style={s.shelfGrid}>
              {Array.from({ length: 5 }).map((_, i) => {
                const shelf = answers.shelf_photos || [];
                const filled = i < shelf.length;
                const isNext = i === shelf.length && shelf.length < 5;
                if (filled) return (
                  <View key={i} style={[s.shelfSlot, s.shelfSlotFilled]}>
                    <Image source={{ uri: shelf[i] }} style={{ width: '100%', height: '100%', borderRadius: 10 }} resizeMode="cover" />
                    <Pressable
                      style={s.shelfRemove}
                      onPress={() => setAns(a => ({ ...a, shelf_photos: (a.shelf_photos || []).filter((_, j) => j !== i) }))}
                    >
                      <View style={s.shelfRemoveBadge}>
                        <Text style={{ fontSize: 11, color: '#FFF', lineHeight: 16 }}>✕</Text>
                      </View>
                    </Pressable>
                  </View>
                );
                if (isNext) return (
                  <View key={i} style={s.shelfSlotNext}>
                    <Pressable style={s.shelfAdd} onPress={() => shelfCaptureRefs[i].current.click()}>
                      <Text style={s.shelfAddText}>📷</Text>
                    </Pressable>
                    <Pressable style={s.shelfAdd} onPress={() => shelfInputRefs[i].current.click()}>
                      <Text style={s.shelfAddText}>🖼</Text>
                    </Pressable>
                  </View>
                );
                return <View key={i} style={s.shelfSlotEmpty} />;
              })}
            </View>
            <Btn onPress={next} accent label={(answers.shelf_photos || []).length > 0 ? 'Continue →' : 'Skip for now →'} />
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
                    <Image source={{ uri: shelf[i] }} style={{ width: '100%', height: '100%', borderRadius: 10 }} resizeMode="cover" />
                    <Pressable
                      style={s.shelfRemove}
                      onPress={() => setAns(a => ({ ...a, shelf_photos: (a.shelf_photos || []).filter((_, j) => j !== i) }))}
                    >
                      <View style={s.shelfRemoveBadge}>
                        <Text style={{ fontSize: 11, color: '#FFF', lineHeight: 16 }}>✕</Text>
                      </View>
                    </Pressable>
                  </View>
                );
                if (isNext) return (
                  <View key={i} style={s.shelfSlotNext}>
                    <Pressable
                      style={s.shelfAdd}
                      onPress={() => shelfCaptureRefs[i].current.click()}
                    >
                      <Text style={s.shelfAddText}>📷</Text>
                    </Pressable>
                    <Pressable
                      style={s.shelfAdd}
                      onPress={() => shelfInputRefs[i].current.click()}
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

        {/* BIRTHDAY */}
        {q.type === 'birthday' && (
          <>
            <DrumDatePicker
              value={answers[q.id]}
              onChange={v => setAns(a => ({ ...a, [q.id]: v }))}
              yearsFrom={1924}
              yearsTo={new Date().getFullYear() - 10}
            />
            <Btn onPress={next} label="Continue →" />
          </>
        )}

        {/* NAME */}
        {q.type === 'name' && (
          <>
            <TextInput
              style={s.input}
              placeholder={q.placeholder}
              placeholderTextColor={C.muted}
              autoCapitalize="words"
              value={answers[q.id] || ''}
              onChangeText={t => setAns(a => ({ ...a, [q.id]: t }))}
            />
            <Btn onPress={next} label="Continue →" />
          </>
        )}

        {/* INTERESTS */}
        {q.type === 'interests' && (
          <>
            <View style={s.chipRow}>
              {q.options.map(v => {
                const active = multi.includes(v);
                return (
                  <Pressable
                    key={v}
                    onPress={() => setMulti(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])}
                    style={[s.chip, active && s.chipActive]}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Btn onPress={next} disabled={multi.length === 0} label="Continue →" />
          </>
        )}

        {/* EVENT */}
        {q.type === 'event' && (
          <>
            {q.options.map(o => (
              <Pressable
                key={o.value}
                onPress={() => setSel(o.value)}
                style={[s.optionCard, sel === o.value && s.optionCardSelected]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={s.optionIconCircle}>
                    <Text style={{ fontSize: 16 }}>{o.icon}</Text>
                  </View>
                  <Text style={[s.optionLabel, sel === o.value && s.optionLabelSelected]}>{o.label}</Text>
                </View>
                {sel === o.value && <Text style={s.check}>✓</Text>}
              </Pressable>
            ))}
            <Btn onPress={next} disabled={!sel} label="Continue →" />
          </>
        )}

        {/* EVENT DATE */}
        {q.type === 'event_date' && (
          <>
            <DrumDatePicker
              value={answers[q.id]}
              onChange={v => setAns(a => ({ ...a, [q.id]: v }))}
              yearsFrom={new Date().getFullYear()}
              yearsTo={new Date().getFullYear() + 3}
            />
            <Btn onPress={next} label="Continue →" />
            <Pressable
              onPress={() => {
                setAns(a => ({ ...a, event_date: null }));
                Animated.sequence([
                  Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
                  Animated.timing(fadeAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
                ]).start();
                setTimeout(() => setIdx(i => i + 1), 120);
              }}
              style={s.ghostBtn}
            >
              <Text style={s.ghostText}>Skip this question</Text>
            </Pressable>
          </>
        )}

        {/* COMPLETION */}
        {q.type === 'completion' && (
          <View style={s.completionBlock}>
            <Text style={s.completionEmoji}>🌿</Text>
            <Text style={s.completionHeading}>Your Skin Era is ready</Text>
            <Text style={s.completionSub}>We're analyzing your answers to build your personalized routine.</Text>
            <Btn onPress={next} accent label="See my Skin Era →" />
          </View>
        )}

        <View style={{ height: 40 }} />
      </Animated.ScrollView>

      {/* Hidden file inputs — outside ScrollView, synchronous trigger from gesture */}
      {['photo_right', 'photo_left', 'photo_front'].map(key => (
        <React.Fragment key={key}>
          <input type="file" accept="image/*" ref={photoInputRefs[key]} style={{ display: 'none' }} onChange={e => onFileChange(key, e)} />
          <input type="file" accept="image/*" capture="user" ref={photoCaptureRefs[key]} style={{ display: 'none' }} onChange={e => onFileChange(key, e)} />
        </React.Fragment>
      ))}
      {shelfInputRefs.map((ref, i) => (
        <React.Fragment key={`shelf-${i}`}>
          <input type="file" accept="image/*" ref={ref} style={{ display: 'none' }} onChange={onShelfFileChange} />
          <input type="file" accept="image/*" capture="environment" ref={shelfCaptureRefs[i]} style={{ display: 'none' }} onChange={onShelfFileChange} />
        </React.Fragment>
      ))}
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
  photoIcon:      { width: 36, height: 36, borderRadius: 8, backgroundColor: '#F0EBE5', borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoIconDone:  { backgroundColor: '#7A9E6E25', borderColor: '#7A9E6E', borderStyle: 'solid' },
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
  shelfSlot:  { width: '30%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  shelfSlotFilled: { backgroundColor: '#7A9E6E20', borderWidth: 1.5, borderColor: '#7A9E6E50' },
  shelfSlotNext:   { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, overflow: 'hidden' },
  shelfSlotEmpty:  { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#F9F7F4' },
  shelfRemove:     { position: 'absolute', top: 4, right: 4 },
  shelfRemoveBadge:{ width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  shelfAdd:   { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: C.border },
  shelfAddText:{ fontSize: 18 },

  btn:         { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 16 },
  btnDisabled: { backgroundColor: '#D4CBC4' },
  btnText:     { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  footnote:    { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', fontStyle: 'italic' },

  input:             { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, padding: 14, fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.text, marginBottom: 16 },
  optionIconCircle:  { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0EBE5', alignItems: 'center', justifyContent: 'center' },
  ghostBtn:          { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center', marginBottom: 16 },
  ghostText:         { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  completionBlock:   { alignItems: 'center', paddingTop: 20, paddingBottom: 20, width: '100%' },
  completionEmoji:   { fontSize: 56, marginBottom: 24 },
  completionHeading: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, textAlign: 'center', marginBottom: 12 },
  completionSub:     { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
});
