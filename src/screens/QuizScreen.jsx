import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView,
  StyleSheet, Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { C, QUESTIONS, SKIN_TONES } from '../constants';
import { useApp } from '../context/AppContext';
import { initAndStartScan } from '../lib/skinScan';
import LocationQuestion from '../components/LocationQuestion';

const START_IDX = QUESTIONS.findIndex(q => q.id === 'name');
const PROGRESS_QUESTIONS = QUESTIONS.filter(q => q.countsInProgress !== false);

const PHOTO_ANGLES = [
  { key: 'front',   label: 'Straight on',        hint: 'Face forward, chin slightly down' },
  { key: 'left',    label: 'Left side of face',  hint: 'Turn your left cheek toward the light' },
  { key: 'right',   label: 'Right side of face', hint: 'Turn your right cheek toward the light' },
  { key: 'closeup', label: 'Close-up',           hint: 'Move closer — fill the frame with your skin texture' },
  { key: 'neck',    label: 'Neck',               hint: 'Tilt your chin up slightly to show your neck' },
];

const text = (v, name) => typeof v === 'function' ? v(name) : v;

// Skip forward over any question whose showIf(answers) is false (hormones, top_concern, event_date).
function advance(fromIdx, answers) {
  let i = fromIdx + 1;
  while (QUESTIONS[i] && QUESTIONS[i].showIf && !QUESTIONS[i].showIf(answers)) i++;
  return i;
}

// ─── Greeting (auto-advance micro-moment, right after Name) ─────────────────
function GreetingScreen({ text: greetText, onDone, autoAdvanceMs }) {
  useEffect(() => {
    const t = setTimeout(onDone, autoAdvanceMs);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={s.greetWrap}>
      <Text style={s.greetWave}>👋</Text>
      <Text style={s.greetText}>{greetText}</Text>
    </View>
  );
}

// ─── Chapter interstitial (auto-advance chapter transition) ─────────────────
function ChapterInterstitial({ chapterNumber, totalChapters, chapterName, headline, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={s.interWrap}>
      <Text style={s.interEyebrow}>Chapter {chapterNumber} · {chapterName}</Text>
      <Text style={s.interHeadline}>{headline}</Text>
      <View style={s.interDots}>
        {Array.from({ length: totalChapters }, (_, i) => (
          <View key={i} style={[s.interDot, i < chapterNumber && s.interDotOn]} />
        ))}
      </View>
    </View>
  );
}

// ─── Drum Date Picker ────────────────────────────────────────────────────────
const ITEM_H     = 52;
const VISIBLE    = 5;
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
      style={{ flex, height: ITEM_H * VISIBLE }}
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
    const midYear  = String(yearsFrom + Math.floor((yearsTo - yearsFrom) / 2));
    return { dayIdx: 0, monthIdx: 0, yearIdx: Math.max(0, YEARS_LIST.indexOf(midYear)) };
  };

  const init    = parseVal();
  const idxRef  = useRef({ ...init });

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

export default function QuizScreen({ navigation, route }) {
  const { setAnswers: saveAnswers } = useApp();
  const [idx, setIdx]       = useState(START_IDX);
  const [answers, setAns]   = useState(() => ({
    consentAcceptedAt: route?.params?.consentAcceptedAt || null,
    consentVersion: route?.params?.consentVersion || null,
  }));
  const [sel, setSel]       = useState(null);
  const [multi, setMulti]   = useState([]);
  const fadeAnim            = useRef(new Animated.Value(1)).current;
  const scanPromiseRef      = useRef(null);
  const q                   = QUESTIONS[idx];
  const isLast              = idx === QUESTIONS.length - 1;

  const progressIdx        = PROGRESS_QUESTIONS.findIndex(pq => pq.id === q.id) + 1;
  const totalProgressSteps = PROGRESS_QUESTIONS.length;

  useEffect(() => {
    if (q.type === 'multi') setMulti(answers[q.id] || []);
    else setSel(answers[q.id] || null);
  }, [idx]);

  function goTo(nextIdx) {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setIdx(nextIdx), 120);
  }

  async function next() {
    let a = { ...answers };
    if (q.type === 'multi') a[q.id] = multi;
    else if ((q.type === 'single' && !q.cardStyle) || q.type === 'tone' || q.type === 'event') a[q.id] = sel;
    setAns(a);

    // Kick off the PerfectCorp skin scan as soon as photos are captured — well before Loading —
    // so it has the most possible head start against its own soft timeout. Never awaited: a vendor
    // failure here must not block the quiz, same posture as every other photo-analysis failure path.
    if (q.type === 'photos' && a.front) {
      scanPromiseRef.current = initAndStartScan({
        front: a.front, left: a.left, right: a.right,
        quizAnswers: { skin_goals: a.skin_goals, top_concern: a.top_concern, post_cleanse_feel: a.post_cleanse_feel },
      }).then(scanRef => {
        if (scanRef) setAns(prev => ({ ...prev, ...scanRef }));
        return scanRef;
      });
    }

    if (isLast) {
      if (!a.skinScanId && scanPromiseRef.current) {
        const scanRef = await Promise.race([
          scanPromiseRef.current,
          new Promise(resolve => setTimeout(() => resolve(null), 10000)),
        ]);
        if (scanRef) a = { ...a, ...scanRef };
      }
      saveAnswers(prev => ({ ...(prev || {}), ...a }));
      navigation.navigate('Loading');
      return;
    }
    goTo(advance(idx, a));
  }

  const toggleMulti = v =>
    setMulti(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  // Build a data URL so photos travel as base64 to the API (native uri alone
  // is a file:// path the backend can't read).
  function assetToDataUrl(asset) {
    if (asset.base64) {
      const mime = asset.mimeType || 'image/jpeg';
      return `data:${mime};base64,${asset.base64}`;
    }
    return asset.uri; // fallback (web already yields a data/blob URL)
  }

  async function pickPhoto(key) {
    const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!res.granted) {
      Alert.alert('Permission needed', 'Enable photo library access in Settings to upload photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled) {
      setAns(a => ({ ...a, [key]: assetToDataUrl(result.assets[0]) }));
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
      base64: true,
    });
    if (!result.canceled) {
      setAns(a => ({ ...a, [key]: assetToDataUrl(result.assets[0]) }));
    }
  }

  // ── Greeting & Chapter interstitial: full-screen auto-advancing moments, no header/progress ──
  if (q.type === 'greeting') {
    return (
      <SafeAreaView style={s.safe}>
        <GreetingScreen text={text(q.text, answers.name)} autoAdvanceMs={q.autoAdvanceMs}
          onDone={() => goTo(advance(idx, answers))} />
      </SafeAreaView>
    );
  }
  if (q.type === 'interstitial') {
    return (
      <SafeAreaView style={s.safe}>
        <ChapterInterstitial
          chapterNumber={q.chapterNumber} totalChapters={q.totalChapters}
          chapterName={q.chapterName} headline={q.headline}
          onDone={() => goTo(advance(idx, answers))}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.logo}>Get Pretty</Text>
        {progressIdx > 0 && <Text style={s.counter}>Step {progressIdx} of {totalProgressSteps}</Text>}
      </View>
      {progressIdx > 0 && (
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${(progressIdx / totalProgressSteps) * 100}%` }]} />
        </View>
      )}

      <Animated.ScrollView style={[s.scroll, { opacity: fadeAnim }]} contentContainerStyle={s.content}>
        {q.chapter && <Text style={s.chapterLabel}>{q.chapter}</Text>}
        <Text style={s.emoji}>{q.emoji}</Text>
        <Text style={s.question}>{text(q.question, answers.name)}</Text>
        {q.hint && <Text style={s.hint}>{q.hint}</Text>}
        {q.why && <Text style={s.why}>{text(q.why, answers.name)}</Text>}
        {q.fact && <Text style={s.fact}>💡 {q.fact}</Text>}
        {q.checklist && <Text style={s.checklistText}>{q.checklist.map(c => `✔ ${c}`).join('   ')}</Text>}

        {/* SINGLE SELECT (standard) */}
        {q.type === 'single' && !q.cardStyle && (
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

        {/* SINGLE SELECT (descriptive cards — gender) */}
        {q.type === 'single' && q.cardStyle && (
          <>
            {q.options.map(o => {
              const active = answers[q.id] === o.value;
              return (
                <Pressable key={o.value} onPress={() => setAns(a => ({ ...a, [q.id]: o.value }))}
                  style={[s.genderCard, active && s.genderCardActive]}>
                  <Text style={s.genderIcon}>{o.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.genderLabel}>{o.label}</Text>
                    <Text style={s.genderDesc}>{o.desc}</Text>
                  </View>
                  {active && <Text style={s.check}>✓</Text>}
                </Pressable>
              );
            })}
            <Btn onPress={next} disabled={!answers[q.id]} label="Next →" />
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

        {/* MULTI SELECT (flat) */}
        {q.type === 'multi' && !q.groups && (
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
            {q.options.some(o => o.freeText && multi.includes(o.value)) && (
              <TextInput
                style={s.input}
                placeholder="Tell us more"
                placeholderTextColor={C.muted}
                value={answers[`${q.id}_other`] || ''}
                onChangeText={t => setAns(a => ({ ...a, [`${q.id}_other`]: t }))}
              />
            )}
            <Btn onPress={next} disabled={multi.length === 0} label="Continue →" />
          </>
        )}

        {/* MULTI SELECT (grouped — skin_goals, allergies) */}
        {q.type === 'multi' && q.groups && (
          <>
            {q.groups.map(g => (
              <View key={g.label}>
                <Text style={s.groupLabel}>{g.label}</Text>
                <View style={s.chipRow}>
                  {g.options.map(o => {
                    const active = multi.includes(o.value);
                    return (
                      <Pressable key={o.value} onPress={() => toggleMulti(o.value)}
                        style={[s.chip, active && s.chipActive]}>
                        <Text style={[s.chipText, active && s.chipTextActive]}>{o.emoji ? `${o.emoji} ` : ''}{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            {q.extraOptions && (
              <View style={s.chipRow}>
                {q.extraOptions.map(o => {
                  const active = multi.includes(o.value);
                  return (
                    <Pressable key={o.value} onPress={() => toggleMulti(o.value)}
                      style={[s.chip, active && s.chipActive]}>
                      <Text style={[s.chipText, active && s.chipTextActive]}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {(q.groups.flatMap(g => g.options).concat(q.extraOptions || []))
              .some(o => o.freeText && multi.includes(o.value)) && (
              <TextInput
                style={s.input}
                placeholder="Tell us more"
                placeholderTextColor={C.muted}
                value={answers[`${q.id}_other`] || ''}
                onChangeText={t => setAns(a => ({ ...a, [`${q.id}_other`]: t }))}
              />
            )}
            <Btn onPress={next} disabled={multi.length === 0} label="Next →" />
          </>
        )}

        {/* DYNAMIC TOP CONCERN */}
        {q.type === 'priority' && (() => {
          const allGoalOptions = QUESTIONS.find(x => x.id === 'skin_goals').groups.flatMap(g => g.options);
          const chosen = (answers.skin_goals || [])
            .map(v => allGoalOptions.find(o => o.value === v))
            .filter(Boolean);
          return (
            <>
              {chosen.map(o => {
                const active = answers.top_concern === o.value;
                return (
                  <Pressable key={o.value} onPress={() => setAns(a => ({ ...a, top_concern: o.value }))}
                    style={[s.optionCard, active && s.optionCardSelected]}>
                    <Text style={[s.optionLabel, active && s.optionLabelSelected]}>{o.label}</Text>
                    {active && <Text style={s.check}>✓</Text>}
                  </Pressable>
                );
              })}
              <Btn onPress={next} disabled={!answers.top_concern} label="Next →" />
            </>
          );
        })()}

        {/* LOCATION */}
        {q.type === 'location' && (
          <>
            <LocationQuestion
              value={answers}
              onChange={location => setAns(a => ({ ...a, ...location }))}
            />
            <Btn onPress={next} disabled={!answers.city?.trim()} label="Continue →" />
          </>
        )}

        {/* SLIDER (tap-to-select 1–10 row, with anchors + live emotion label) */}
        {q.type === 'slider' && (
          <>
            {q.anchors && (
              <View style={s.anchorsRow}>
                <Text style={s.anchor}>{q.anchors[0]}</Text>
                <Text style={s.anchor}>{q.anchors[1]}</Text>
              </View>
            )}
            <View style={s.stressRow}>
              {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map(n => {
                const active = answers[q.id] === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setAns(a => ({ ...a, [q.id]: n }))}
                    style={[s.stressDot, active && s.stressDotActive]}
                  >
                    <Text style={[s.stressDotText, active && s.stressDotTextActive]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
            {q.labels && answers[q.id] && <Text style={s.stressLabel}>{q.labels[String(answers[q.id])]}</Text>}
            <Btn onPress={next} disabled={!answers[q.id]} label="Continue →" />
          </>
        )}

        {/* HORMONES (conditional, she/her only — local state only, not sent to AI payload) */}
        {q.type === 'hormones' && (
          <>
            {q.fields.map(f => (
              <View key={f.key} style={{ marginBottom: 18 }}>
                <Text style={s.hormoneLabel}>{f.label}</Text>
                <View style={s.chipRow}>
                  {f.options.map(o => {
                    const active = (answers.hormones || {})[f.key] === o.value;
                    return (
                      <Pressable
                        key={o.value}
                        onPress={() => setAns(a => ({ ...a, hormones: { ...(a.hormones || {}), [f.key]: o.value } }))}
                        style={[s.chip, active && s.chipActive]}
                      >
                        <Text style={[s.chipText, active && s.chipTextActive]}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <Btn onPress={next} label="Continue →" />
          </>
        )}

        {/* PHOTOS */}
        {q.type === 'photos' && (
          <>
            {PHOTO_ANGLES.map(p => {
              const done = !!answers[p.key];
              return (
                <View key={p.key} style={[s.photoCard, done && s.photoCardDone]}>
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
                      <Pressable style={s.photoBtn} onPress={() => takePhoto(p.key)}>
                        <Text style={s.photoBtnText}>📷 Take photo</Text>
                      </Pressable>
                      <View style={s.photoDivider} />
                      <Pressable style={s.photoBtn} onPress={() => pickPhoto(p.key)}>
                        <Text style={s.photoBtnText}>🖼 Upload</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => setAns(a => { const n = { ...a }; delete n[p.key]; return n; })}>
                      <Text style={s.retake}>Remove & retake</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Btn
              onPress={next}
              accent
              label={PHOTO_ANGLES.some(p => answers[p.key]) ? 'Continue →' : 'Skip for now →'}
            />
            <Text style={s.footnote}>We see skin texture, not judgment</Text>
            <Text style={s.footnote}>
              🔒 Your front-facing photo is also sent to our AI skin-analysis partner (PerfectCorp) to
              enrich your results. It's never shared beyond that.
            </Text>
          </>
        )}

        {/* SHELF PHOTOS */}
        {q.type === 'shelf' && (
          <>
            <View style={s.shelfGrid}>
              {Array.from({ length: 9 }).map((_, i) => {
                const shelf = answers.shelf_photos || [];
                const filled = i < shelf.length;
                const isNext = i === shelf.length && shelf.length < 9;
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
                        const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
                        if (!result.canceled) setAns(a => ({ ...a, shelf_photos: [...(a.shelf_photos || []), assetToDataUrl(result.assets[0])] }));
                      }}
                    >
                      <Text style={s.shelfAddText}>📷</Text>
                    </Pressable>
                    <Pressable
                      style={s.shelfAdd}
                      onPress={async () => {
                        const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
                        if (!result.canceled) setAns(a => ({ ...a, shelf_photos: [...(a.shelf_photos || []), assetToDataUrl(result.assets[0])] }));
                      }}
                    >
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
                goTo(advance(idx, answers));
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
            <Text style={s.completionHeading}>{text(q.headline, answers.name)}</Text>
            <Text style={s.completionSub}>We're analyzing your answers to build your personalized routine.</Text>
            <Btn onPress={next} accent label="See my Skin Era →" />
          </View>
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
  chapterLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 12 },
  emoji:       { fontSize: 38, marginBottom: 14 },
  question:    { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.text, lineHeight: 32, marginBottom: 4 },
  hint:        { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 20, lineHeight: 19 },
  why:         { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 6, marginBottom: 16 },
  fact:        { backgroundColor: C.accentLight, borderRadius: 12, padding: 12, fontFamily: 'DMSans_400Regular', fontSize: 11.5, lineHeight: 16, color: '#8A6A55', marginBottom: 18 },
  checklistText:{ fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: C.muted, lineHeight: 20, marginBottom: 16 },

  optionCard:         { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  optionCardSelected: { backgroundColor: C.accentLight, borderColor: C.accent },
  optionLabel:        { fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#4A4039' },
  optionLabelSelected:{ fontFamily: 'DMSans_500Medium', color: C.accent },
  optionSub:          { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  check:              { color: C.accent, fontWeight: '700', fontSize: 16 },

  genderCard:       { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 15, padding: 14, marginBottom: 11 },
  genderCardActive: { borderColor: C.accent, backgroundColor: C.accentLight },
  genderIcon:       { fontSize: 22 },
  genderLabel:      { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text },
  genderDesc:       { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, marginTop: 1, lineHeight: 15 },

  toneGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  toneCard:   { width: '47%', borderRadius: 13, padding: 14, backgroundColor: C.card, borderWidth: 2, borderColor: C.border, gap: 8 },
  toneSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(0,0,0,0.08)' },
  toneLabel:  { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, marginBottom: 1 },
  toneSub:    { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, lineHeight: 14 },

  groupLabel:   { fontFamily: 'DMSans_500Medium', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: C.accent, marginTop: 10, marginBottom: 8 },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 16 },
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

  input:             { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, padding: 14, fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.text, marginBottom: 16 },
  optionIconCircle:  { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0EBE5', alignItems: 'center', justifyContent: 'center' },
  anchorsRow:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  anchor:            { fontSize: 16 },
  stressRow:         { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 14 },
  stressDot:         { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  stressDotActive:   { backgroundColor: C.accent, borderColor: C.accent },
  stressDotText:     { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text },
  stressDotTextActive: { color: '#FFF' },
  stressLabel:       { fontFamily: 'CormorantGaramond_500Medium', fontStyle: 'italic', fontSize: 16, color: C.accent, textAlign: 'center', marginBottom: 20 },
  hormoneLabel:      { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 8 },
  ghostBtn:          { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center', marginBottom: 16 },
  ghostText:         { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  completionBlock:   { alignItems: 'center', paddingTop: 20, paddingBottom: 20, width: '100%' },
  completionEmoji:   { fontSize: 56, marginBottom: 24 },
  completionHeading: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, textAlign: 'center', marginBottom: 12 },
  completionSub:     { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },

  greetWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  greetWave: { fontSize: 36, marginBottom: 14 },
  greetText: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.text, textAlign: 'center', lineHeight: 30 },

  interWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: C.bg },
  interEyebrow: { fontFamily: 'DMSans_500Medium', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: C.accent, marginBottom: 16 },
  interHeadline: { fontFamily: 'CormorantGaramond_500Medium', fontStyle: 'italic', fontSize: 24, color: C.text, textAlign: 'center', lineHeight: 32, marginBottom: 26 },
  interDots: { flexDirection: 'row', gap: 8 },
  interDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  interDotOn: { backgroundColor: C.accent, width: 20, borderRadius: 99 },
});
