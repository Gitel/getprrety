import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, ScrollView, Modal, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C, MOODS } from '../constants';
import { eraText, analysisAffirmation } from '../lib/eraText';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { logActivity } from '../lib/logActivity';
import FallbackBanner from '../components/FallbackBanner';
import { MenuButton } from '../components/SideMenu';
import { routineSteps, defaultRoutineTab, localDay, routineKeyFor, tickedIndices } from '../lib/homeRoutine';

// The English text homeRoutine.js puts on a routine step when Railway matched no product for it.
// homeRoutine must stay language-independent (its steps feed routineKeyFor, which names the day's
// ticks), so the translation happens here in the JSX, only for this exact English string.
const SOURCE_EXTERNALLY_EN = 'Source externally for this step.';

// Invisible Unicode "isolate" marks: text between them keeps its own direction, so a Latin text
// (AI output, always English) inside a Hebrew sentence cannot scramble the surrounding text.
const FSI = '\u2068';
const PDI = '\u2069';

export default function HomeScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { analysis, user, unreadMessages, refreshUnreadMessages } = useApp();
  const era     = analysis?.era;
  const hour    = new Date().getHours();

  // Home is re-mounted every time the user comes back to it (only the top screen of the
  // stack is mounted), so this refreshes the message badge after login and after
  // leaving the Messages screen. App resumes are covered in AppContext.
  // (The steps shown come from routineSteps() below, not analysis.routine directly.)
  useEffect(() => { refreshUnreadMessages(); }, []);

  // Opens on the routine the user said they do (onboarding), else the next one by time.
  const [tab,       setTab]      = useState(() => defaultRoutineTab(user?.skincareTiming, hour));
  // Ticked steps as { am0: true, pm2: true, ... }; restored from / saved to the server.
  const [done,      setDone]     = useState({});
  const [ciOpen,    setCiOpen]   = useState(false);
  const [checkedIn, setCheckedIn]= useState(null);
  const [mood,      setMood]     = useState(null);

  // Product routine when Railway matched products, else the generic routine (homeRoutine.js).
  const amSteps    = routineSteps(analysis, 'am');
  const pmSteps    = routineSteps(analysis, 'pm');
  const steps      = tab === 'am' ? amSteps : pmSteps;
  const routineKey = routineKeyFor(amSteps, pmSteps);
  const today      = localDay();
  const doneCount  = steps.filter((_, i) => done[tab + i]).length;
  const allDone    = doneCount === steps.length && steps.length > 0;
  const greeting   = hour < 12 ? t('home:greeting.morning') : hour < 17 ? t('home:greeting.afternoon') : t('home:greeting.evening');
  // Keys built at run time use a template literal (the static-keys test only checks quoted keys;
  // quizValues/home tests check every mood id exists).
  // Display text of a mood. The STORED value stays the English m.label (check-in POST + lookup).
  const moodText  = m => (m ? t(`home:moods.${m.id}`) : '');

  // Saves go out one after another, so they reach the server in tap order (last tap wins).
  const saveChain = useRef(Promise.resolve());
  // Once the user taps, a late-arriving server copy must not overwrite their taps.
  const touched   = useRef(false);
  // Always the latest ticks. toggle() builds on this instead of the `done` captured at
  // render time, so two taps landing before a re-render cannot drop the first one, while
  // the network call stays outside the (pure) state update.
  const doneRef   = useRef({});
  function applyDone(next) {
    doneRef.current = next;
    setDone(next);
  }
  // The routine the ticks in `done` belong to. Ticks are step POSITIONS, so if the steps
  // change while Home stays open (a clinic edit arriving on resume, or the first resume
  // after a quiz swapping in the server's sanitized copy), keeping them would tick the
  // wrong steps, and the next tap would save that under the new routine.
  const ticksKey  = useRef(routineKey);

  // Restore today's ticks. Ignored if they were saved for a different routine (retake).
  useEffect(() => {
    // Routine changed under an open Home: start it unticked (owner decision: clear on any
    // change, even a cosmetic one). `touched` is reset too, so ticks the server has for
    // this exact routine can still be restored below.
    if (ticksKey.current !== routineKey) {
      ticksKey.current = routineKey;
      touched.current = false;
      applyDone({});
    }
    if (!user || !analysis) return;
    let cancelled = false;
    api.get(`/api/routine-progress?date=${today}`)
      .then(({ progress }) => {
        if (cancelled || touched.current || !progress || progress.routineKey !== routineKey) return;
        const restored = {};
        progress.am.forEach(i => { restored['am' + i] = true; });
        progress.pm.forEach(i => { restored['pm' + i] = true; });
        applyDone(restored);
      })
      .catch(() => {}); // offline: start the day unticked, as before
    return () => { cancelled = true; };
  }, [Boolean(user), routineKey, today]);

  function toggle(i) {
    touched.current = true;
    const current = doneRef.current;
    const next = { ...current, [tab + i]: !current[tab + i] };
    applyDone(next);
    if (!user) return;
    const body = { date: today, routineKey, am: tickedIndices(next, 'am'), pm: tickedIndices(next, 'pm') };
    saveChain.current = saveChain.current
      .then(() => api.put('/api/routine-progress', body))
      .catch(err => console.warn('Routine progress not saved:', err?.message)); // tick stays on screen
  }

  if (!analysis) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          <Text style={{ fontSize: 42, marginBottom: 16 }}>🌿</Text>
          <Text style={[s.doneTitleText, { color: C.text, marginBottom: 10 }]}>{t('home:empty.title')}</Text>
          <Text style={[s.doneMsg, { marginBottom: 22 }]}>{t('home:empty.body')}</Text>
          <Pressable style={[s.productCta, { borderColor: C.accent }]} onPress={() => navigation.navigate('QuizIntro')}>
            <Text style={s.productCtaTitle}>{t('home:empty.cta')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: era.bg }]}>
      <ScrollView contentContainerStyle={s.content}>

        {/* Greeting row */}
        <View style={s.greetingRow}>
          {/* Menu button first: top-left in English, top-right in Hebrew (a row mirrors in RTL). */}
          <View style={s.greetingLeft}>
            <View style={s.menuBtnWrap}>
              <MenuButton onPress={navigation.openMenu} color={era.color} />
            </View>
            <View style={s.greetingBlock}>
              <Text style={s.greetingText}>{greeting}</Text>
              <Text style={[s.eraTag, { color: era.color }]}>{era.emoji} {eraText(era, 'name', lang)}</Text>
            </View>
          </View>
          <View style={s.headerActions}>
            {/* Messages with the clinic; the badge counts clinic messages not opened yet. */}
            <Pressable
              onPress={() => navigation.navigate('Messages')}
              accessibilityLabel={unreadMessages ? t('home:messages.unread', { count: unreadMessages }) : t('home:messages.label')}
            >
              <Text style={{ fontSize: 19 }}>💬</Text>
              {unreadMessages > 0 && (
                <View style={s.msgBadge}>
                  <Text style={s.msgBadgeText}>{unreadMessages > 9 ? '9+' : unreadMessages}</Text>
                </View>
              )}
            </Pressable>
            {/* "My skin profile" and Settings now live in the side menu. */}
          </View>
        </View>

        {/* Generic-result warning + Try again / Retake (renders nothing for real results) */}
        <FallbackBanner analysis={analysis} navigation={navigation} />

        {/* Check-in card */}
        {!checkedIn ? (
          <Pressable
            style={[s.checkInCard, { borderColor: era.color + '40' }]}
            onPress={() => setCiOpen(true)}
          >
            <Text style={{ fontSize: 22 }}>🪞</Text>
            <View style={{ flex: 1, marginStart: 14 }}>
              <Text style={s.checkInTitle}>{t('home:checkIn.title')}</Text>
              <Text style={s.checkInSub}>{t('home:checkIn.subtitle')}</Text>
            </View>
            <Text style={[s.checkInArrow, { color: era.color }]}>{t('common:arrowNext')}</Text>
          </Pressable>
        ) : (
          <View style={[s.checkInDone, { borderColor: era.color + '40' }]}>
            <Text style={s.checkInDoneText}>
              {MOODS.find(m => m.label === checkedIn)?.emoji} {t('home:checkIn.complete', { mood: moodText(MOODS.find(m => m.label === checkedIn)) || checkedIn })}
            </Text>
          </View>
        )}

        {/* Progress */}
        <View style={s.progressRow}>
          <Text style={s.progressLabel}>{t('home:progress.steps', { count: steps.length, done: doneCount, total: steps.length })}</Text>
          {allDone && <Text style={[s.progressDone, { color: era.color }]}>{t('home:progress.ritualComplete')}</Text>}
        </View>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: steps.length ? `${(doneCount / steps.length) * 100}%` : '0%', backgroundColor: era.color }]} />
        </View>
        <Text style={s.progressHint}>{t('home:progress.hint')}</Text>

        {/* AM / PM tabs */}
        <View style={s.tabs}>
          {[{ key:'am', label: t('home:tabs.am') }, { key:'pm', label: t('home:tabs.pm') }].map(tb => (
            <Pressable
              key={tb.key}
              onPress={() => setTab(tb.key)}
              style={[s.tabBtn, tab === tb.key && { borderBottomColor: era.color }]}
            >
              <Text style={[s.tabText, tab === tb.key && { color: era.color, fontFamily: 'DMSans_500Medium' }]}>{tb.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Steps */}
        <View style={s.stepList}>
          {steps.map((step, i) => (
            <Pressable
              key={i}
              onPress={() => toggle(i)}
              style={[s.stepCard, done[tab + i] && { opacity: 0.5 }]}
            >
              <View style={[s.stepNum, done[tab + i] && { backgroundColor: era.color }]}>
                <Text style={[s.stepNumText, done[tab + i] && { color: '#FFF' }]}>
                  {done[tab + i] ? '✓' : i + 1}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                {/* Product steps carry their routine slot (e.g. "cleanser") as a caption */}
                {step.category ? <Text style={s.stepCategory}>{step.category}</Text> : null}
                <Text style={[s.stepName, done[tab + i] && { textDecorationLine: 'line-through' }]}>{step.name}</Text>
                <Text style={s.stepDesc}>{step.description === SOURCE_EXTERNALLY_EN ? t('home:routine.sourceExternally') : step.description}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Completion card */}
        {allDone && (
          <View style={[s.doneCard, { backgroundColor: era.color + '15', borderColor: era.color + '40' }]}>
            <Text style={{ fontSize: 32, marginBottom: 10 }}>🎉</Text>
            <Text style={[s.doneTitleText, { color: era.color }]}>{t('home:done.title')}</Text>
            {/* Looked up by era id; an unknown id shows nothing (as before). */}
            <Text style={s.doneMsg}>{t(`content:doneMsgs.${era.id}`, { defaultValue: '' })}</Text>
          </View>
        )}

        {/* Affirmation */}
        <View style={[s.affirmCard, { borderColor: era.color + '25' }]}>
          {/* The affirmation is usually AI text (English), so it is isolated inside the quotes. */}
          <Text style={[s.affirmText, { color: '#6B5E57' }]}>"{FSI}{analysisAffirmation(analysis, lang)}{PDI}"</Text>
        </View>

        {/* Full analysis: Profile (analysis, insights, product audit, product routine,
            shelf) used to be reachable only right after the quiz. */}
        <Pressable
          style={[s.productCta, { borderColor: era.color + '40', marginBottom: 12 }]}
          onPress={() => navigation.navigate('Profile', { fromHome: true })}
        >
          <Text style={{ fontSize: 20 }}>🔬</Text>
          <View style={{ flex: 1, marginStart: 12 }}>
            <Text style={s.productCtaTitle}>{t('home:viewAnalysis.title')}</Text>
            <Text style={s.productCtaSub}>{t('home:viewAnalysis.subtitle')}</Text>
          </View>
          <Text style={[s.checkInArrow, { color: era.color }]}>{t('common:arrowNext')}</Text>
        </Pressable>

        {/* Product camera CTA */}
        <Pressable
          style={[s.productCta, { borderColor: era.color + '40' }]}
          onPress={() => navigation.navigate('ProductCamera')}
        >
          <Text style={{ fontSize: 20 }}>📦</Text>
          <View style={{ flex: 1, marginStart: 12 }}>
            <Text style={s.productCtaTitle}>{t('home:logProducts.title')}</Text>
            <Text style={s.productCtaSub}>{t('home:logProducts.subtitle')}</Text>
          </View>
          <Text style={[s.checkInArrow, { color: era.color }]}>{t('common:arrowNext')}</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Check-in modal */}
      <Modal visible={ciOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{t('home:checkIn.modalTitle')}</Text>
              <Pressable onPress={() => setCiOpen(false)}>
                <Text style={{ fontSize: 18, color: C.muted }}>✕</Text>
              </Pressable>
            </View>
            <Text style={s.modalQuestion}>{t('home:checkIn.question')}</Text>
            <View style={s.moodRow}>
              {MOODS.map(m => (
                <Pressable
                  key={m.label}
                  onPress={() => setMood(m.label)}
                  style={[s.moodBtn, mood === m.label && { borderColor: era.color, backgroundColor: era.bg }]}
                >
                  <Text style={{ fontSize: 20 }}>{m.emoji}</Text>
                  <Text style={[s.moodLabel, mood === m.label && { color: era.color }]}>{moodText(m)}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => {
                if (!mood) return;
                api.post('/api/checkins', { mood }).catch(() => {});
                logActivity('checkin');
                setCheckedIn(mood);
                setCiOpen(false);
                setMood(null);
              }}
              disabled={!mood}
              style={[s.moodCta, { backgroundColor: mood ? era.color : '#D4CBC4' }]}
            >
              <Text style={s.moodCtaText}>{t('home:checkIn.save')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1 },
  content:     { padding: 22, paddingTop: 22 },
  greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  // Lets a long era name wrap instead of pushing the header buttons off-screen.
  // Menu button + greeting text, grouped so the Messages button stays on the far side.
  greetingLeft: { flexDirection: 'row', alignItems: 'flex-start', flexShrink: 1, marginEnd: 10 },
  menuBtnWrap: { marginEnd: 14, paddingTop: 2 },
  greetingBlock: { flexShrink: 1 }, // start/end = left/right in English, mirrored in Hebrew (RTL)
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Small red count pinned to the top-right of the message icon.
  msgBadge:    { position: 'absolute', top: -5, end: -9, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: '#C44B4B', alignItems: 'center', justifyContent: 'center' },
  msgBadgeText:{ fontFamily: 'DMSans_500Medium', fontSize: 9, color: '#FFFFFF' },
  greetingText:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, marginBottom: 4 },
  eraTag:      { fontFamily: 'CormorantGaramond_500Medium', fontSize: 17 },
  checkInCard: { backgroundColor: C.card, borderWidth: 1.5, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  checkInTitle:{ fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 2 },
  checkInSub:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  checkInArrow:{ fontSize: 16 },
  checkInDone: { borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 22 },
  checkInDoneText:{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  progressDone: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  progressTrack:{ height: 3, backgroundColor: C.border, borderRadius: 2, marginBottom: 10 },
  progressFill: { height: 3, borderRadius: 2 },
  progressHint: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 18, textAlign: 'center' },
  tabs:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 20 },
  tabBtn:      { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabText:     { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  stepList:    { gap: 10, marginBottom: 24 },
  stepCard:    { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  stepNum:     { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0EBE5', alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: C.muted },
  stepCategory:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  stepName:    { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 2 },
  stepDesc:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 18 },
  doneCard:    { borderWidth: 1.5, borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' },
  doneTitleText:{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 17, marginBottom: 8 },
  doneMsg:     { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6B5E57', lineHeight: 22, textAlign: 'center' },
  affirmCard:  { borderWidth: 1, borderRadius: 13, padding: 18, marginBottom: 16, alignItems: 'center' },
  affirmText:  { fontFamily: 'CormorantGaramond_400Regular', fontSize: 14, lineHeight: 23, fontStyle: 'italic', textAlign: 'center' },
  productCta:  { backgroundColor: C.card, borderWidth: 1.5, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center' },
  productCtaTitle:{ fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 2 },
  productCtaSub:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  modalOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalSheet:  { backgroundColor: C.bg, borderRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle:  { fontFamily: 'CormorantGaramond_500Medium', fontSize: 19, color: C.text },
  modalQuestion:{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 17, color: C.text, marginBottom: 18 },
  moodRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  moodBtn:     { borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, borderRadius: 12, padding: 10, paddingHorizontal: 13, alignItems: 'center', gap: 4 },
  moodLabel:   { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#6B5E57' },
  moodCta:     { borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  moodCtaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
});
