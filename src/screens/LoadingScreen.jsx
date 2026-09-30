import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C, QUESTIONS, buildFallback } from '../constants';
import { analyzeWithRailway } from '../lib/analyzeWithRailway';
import { pollScan } from '../lib/skinScan';
import { persistAnalysis, withSavedId, skipRetrySave } from '../lib/persistAnalysis';
import { logActivity } from '../lib/logActivity';
import { useApp } from '../context/AppContext';

// Number of loading stages: stageCount of the completion entry in constants.js. The stage texts
// (quiz:completion.stages.0 ...) are looked up at render time so they follow the current language.
const STAGE_COUNT = QUESTIONS.find(q => q.id === 'completion').stageCount;
const STAGE_MS    = 1400;

// Once the Era analysis is in, give the PerfectCorp skin scan a limited extra window to land before
// moving on — the Era must never wait on a vendor. If it lands late, it's simply left off this
// analysis; ProfileScreen only renders the AI Skin Scan card when present.
const SCAN_SOFT_TIMEOUT_MS = 25000;
const SCAN_POLL_MS         = 1500;
// Scan-wait messages. `key` is looked up at render time: quiz:loading.scanWait.<key>.
const SCAN_WAIT_COPY = [
  { until: 3000,  key: 'reading' },
  { until: 8000,  key: 'texture' },
  { until: 15000, key: 'barrier' },
  { until: Infinity, key: 'almost' },
];

export default function LoadingScreen({ navigation, route }) {
  const { t } = useTranslation();
  // Set by FallbackBanner's "Try again": a re-run of an analysis that already fell back.
  const isRetry = Boolean(route?.params?.retry);
  const { answers, user, setAnalysis, analysisSaveFailed, setAnalysisSaveFailed } = useApp();
  const [step, setStep]               = useState(0);
  const [complete, setComplete]       = useState(false);
  const [scanWaitLabel, setScanWaitLabel] = useState(null); // a SCAN_WAIT_COPY key, not text
  const called                        = useRef(false);
  // Latest "first save failed" flag for finish(), which runs inside the mount-time effect
  // below and would otherwise see the value from mount. On a retry, the first save can
  // still fail while this analysis is running.
  const saveFailedRef                 = useRef(analysisSaveFailed);
  saveFailedRef.current               = analysisSaveFailed;

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const stepRef  = { current: 0 };
    const apiRef    = { done: false, result: null };
    let finishing = false;

    function finish(skinScan) {
      if (finishing) return;
      finishing = true;
      // result carries srProducts / shelfAnalysis itself (null on a fallback), so it
      // replaces the previous analysis wholesale - no stale SR Ritual after a retake.
      const { result } = apiRef;
      // A retry that falls back AGAIN is not saved, unless the first save failed (rules in
      // skipRetrySave). A retry that succeeds is saved as a new analysis.
      const skipDuplicateFallback = skipRetrySave({ isRetry, result, firstSaveFailed: saveFailedRef.current });
      // The save below and the 700 ms reveal race each other. Whichever finishes second
      // attaches the saved `_id` to the analysis in context, so resume refresh can later
      // swap in clinic edits (it only replaces analyses that have an `_id`).
      let savedRecord = null; // the save response (for its _id, createdAt, firstReadingAt)
      let revealed = false;
      if (user && !skipDuplicateFallback) {
        // Fire-and-forget, matching the post-signup path in SignUpScreen. The Era
        // reveal must not wait on six photo uploads plus three POST attempts; the
        // outcome reaches the user either way, through the ProfileScreen banner.
        persistAnalysis({ analysis: result, answers }).then(
          saved => {
            setAnalysisSaveFailed(false);
            if (!saved?._id) return;
            savedRecord = saved;
            if (revealed) setAnalysis(current => withSavedId(current, saved));
          },
          err => {
            console.error('Failed to save analysis after retries:', err?.message || err);
            logActivity('analysis_save_failed');
            setAnalysisSaveFailed(true);
          },
        );
      }
      setComplete(true);
      setTimeout(() => {
        revealed = true;
        // Save already done -> attach its _id (and "Day N" dates) now; withSavedId(x, null) is x.
        const next = withSavedId({ ...result, skinScan: skinScan || null }, savedRecord);
        // An unsaved retry replaces the fallback on screen, which is the stored one: it takes
        // over that `_id`, or resume refresh (which needs an `_id`) would never again bring in
        // clinic edits this session. If the first save is still in flight, there is no `_id`
        // yet; that save's own callback (withSavedId above, in the first run) attaches it.
        setAnalysis(current => (skipDuplicateFallback ? withSavedId(next, current) : next));
        navigation.navigate('Profile');
      }, 700);
    }

    // Gives the skin scan up to SCAN_SOFT_TIMEOUT_MS to finish, polling GET /api/skin-scan/:id.
    // Whichever comes first — scan completes, fails, or the soft timeout elapses — we proceed.
    function finishWithScan() {
      const scanId = answers?.skinScanId;
      if (!scanId) { finish(null); return; }

      const start = Date.now();
      let settled = false;

      function tick() {
        if (settled) return;
        const elapsed = Date.now() - start;
        setScanWaitLabel(SCAN_WAIT_COPY.find(c => elapsed < c.until).key);

        pollScan(scanId, answers?.skinScanToken).then(result => {
          if (settled) return;
          if (result && (result.status === 'complete' || result.status === 'failed')) {
            settled = true;
            finish(result.status === 'complete' ? result.skinScan : null);
            return;
          }
          if (elapsed >= SCAN_SOFT_TIMEOUT_MS) {
            settled = true;
            finish(null); // scan keeps running server-side; it's just not part of this reveal
            return;
          }
          setTimeout(tick, SCAN_POLL_MS);
        });
      }
      tick();
    }

    // Advance through stages on a fixed cadence, but hold on the last stage
    // (rather than completing) until the real API response is in.
    function advanceStage(i) {
      stepRef.current = i;
      setStep(i);
      if (i < STAGE_COUNT - 1) {
        setTimeout(() => advanceStage(i + 1), STAGE_MS);
      } else if (apiRef.done) {
        finishWithScan();
      }
    }
    advanceStage(0);

    analyzeWithRailway(answers || {})
      .then(analysis => {
        apiRef.result = analysis;
      })
      .catch(err => {
        console.warn('Railway fallback:', err.message);
        // Stamp the canned template as a fallback, with the reason, so it is never
        // mistaken for a personalized result (saved with the analysis; shown as a
        // banner in the app, a marker on /admin and a label in the clinic email).
        apiRef.result = { ...buildFallback(answers || {}), source: 'fallback', fallbackReason: err.message || 'unknown error' };
        // Activity logging needs an account; anonymous users are covered by the saved marker.
        if (user) logActivity('analysis_fallback');
      })
      .finally(() => {
        apiRef.done = true;
        if (stepRef.current === STAGE_COUNT - 1) finishWithScan();
      });
  }, []);

  // Stage texts and the headline (with the user's name, wrapped in Unicode isolates so a name
  // in the other script cannot scramble the punctuation; no name -> the "NoName" text).
  const stages = t(`quiz:completion.stages`, { returnObjects: true }) /* a list of texts, see quiz.json */;
  const personName = (answers?.name || '').trim();
  const title = personName
    ? t('quiz:completion.headline', { name: '\u2068' + personName + '\u2069' })
    : t('quiz:completion.headlineNoName');

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>🌙</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.subtitle}>{t('quiz:loading.subtitle')}</Text>

        <View style={s.steps}>
          {stages.map((label, i) => {
            const isActive = i === step && !complete;
            const isDone   = i < step || complete;
            return (
              <View key={label} style={[s.step, (isDone || isActive) && s.stepVisible]}>
                <View style={[s.dot, isDone && s.dotDone, isActive && s.dotActive]}>
                  <Text style={s.dotText}>{isDone ? '✓' : isActive ? '◐' : ''}</Text>
                </View>
                <Text style={[s.stepLabel, (isDone || isActive) && { color: C.text }]}>{label}</Text>
                {isActive && <Text style={s.inProgress}>{t('quiz:loading.inProgress')}</Text>}
              </View>
            );
          })}
        </View>

        {!complete && scanWaitLabel && (
          <Text style={s.scanWaitLabel}>✨ {t(`quiz:loading.scanWait.${scanWaitLabel}`)}</Text>
        )}

        {complete && (
          <View style={s.doneBadge}>
            <Text style={s.doneText}>{t('quiz:loading.done')}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#FAF3EF' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emoji:     { fontSize: 52, marginBottom: 18 },
  title:     { fontFamily: 'CormorantGaramond_500Medium', fontSize: 21, color: C.text, marginBottom: 8 },
  subtitle:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, marginBottom: 30, lineHeight: 21, fontStyle: 'italic', textAlign: 'center' },
  steps:     { width: '100%', gap: 9, marginBottom: 28 },
  step:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, paddingHorizontal: 16, borderRadius: 12, backgroundColor: 'transparent' },
  stepVisible:{ backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  dot:       { width: 26, height: 26, borderRadius: 13, backgroundColor: '#E8E0D8', alignItems: 'center', justifyContent: 'center' },
  dotDone:   { backgroundColor: '#7A9E6E' },
  dotActive: { backgroundColor: C.accent },
  dotText:   { fontSize: 11, color: '#FFF', fontWeight: '700' },
  stepLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, flex: 1 },
  inProgress:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.accent, fontStyle: 'italic' },
  doneBadge: { backgroundColor: '#7A9E6E15', borderWidth: 1.5, borderColor: '#7A9E6E40', borderRadius: 14, padding: 13, paddingHorizontal: 20 },
  doneText:  { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#7A9E6E' },
  scanWaitLabel: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.accent, fontStyle: 'italic', textAlign: 'center' },
});
