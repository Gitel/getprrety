import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, QUESTIONS, buildFallback } from '../constants';
import { analyzeWithRailway } from '../lib/analyzeWithRailway';
import { pollScan, claimScan } from '../lib/skinScan';
import { sanitizeQuizAnswers } from '../lib/sanitizeQuizAnswers';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';

const COMPLETION = QUESTIONS.find(q => q.id === 'completion');
const STAGES     = COMPLETION.stages;
const STAGE_MS   = 1400;

// Once the Era analysis is in, give the PerfectCorp skin scan a limited extra window to land before
// moving on — the Era must never wait on a vendor. If it lands late, it's simply left off this
// analysis; ProfileScreen only renders the AI Skin Scan card when present.
const SCAN_SOFT_TIMEOUT_MS = 25000;
const SCAN_POLL_MS         = 1500;
const SCAN_WAIT_COPY = [
  { until: 3000,  label: 'Reading your skin…' },
  { until: 8000,  label: 'Looking at texture and hydration…' },
  { until: 15000, label: 'Checking your barrier…' },
  { until: Infinity, label: 'Almost there — putting your plan together…' },
];

export default function LoadingScreen({ navigation }) {
  const { answers, user, setAnalysis, setSrProducts, setShelfAnalysis } = useApp();
  const [step, setStep]               = useState(0);
  const [complete, setComplete]       = useState(false);
  const [scanWaitLabel, setScanWaitLabel] = useState(null);
  const called                        = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const stepRef  = { current: 0 };
    const apiRef    = { done: false, result: null, srProducts: null, shelfAnalysis: null };
    let finishing = false;

    async function finish(skinScan) {
      if (finishing) return;
      finishing = true;
      const { result, srProducts, shelfAnalysis } = apiRef;
      if (user) {
        let scanClaimed = false;
        if (answers?.skinScanId && answers?.skinScanToken) {
          scanClaimed = await claimScan(answers.skinScanId, answers.skinScanToken).catch(() => false);
        }
        await api.post('/api/analysis', {
          eraId: result.era?.id,
          era: result.era,
          skinAnalysis: result.skinAnalysis,
          keyInsights: result.keyInsights,
          productAudit: result.productAudit,
          routine: result.routine,
          affirmation: result.affirmation,
          quizAnswers: sanitizeQuizAnswers(answers),
          skinScanId: scanClaimed ? answers.skinScanId : null,
        }).catch(() => {});
      }
      setComplete(true);
      setTimeout(() => {
        setAnalysis({ ...result, skinScan: skinScan || null });
        if (srProducts) setSrProducts(srProducts);
        if (shelfAnalysis) setShelfAnalysis(shelfAnalysis);
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
        setScanWaitLabel(SCAN_WAIT_COPY.find(c => elapsed < c.until).label);

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
      if (i < STAGES.length - 1) {
        setTimeout(() => advanceStage(i + 1), STAGE_MS);
      } else if (apiRef.done) {
        finishWithScan();
      }
    }
    advanceStage(0);

    analyzeWithRailway(answers || {})
      .then(({ analysis, srProducts, shelfAnalysis }) => {
        apiRef.result = analysis;
        apiRef.srProducts = srProducts;
        apiRef.shelfAnalysis = shelfAnalysis;
      })
      .catch(err => {
        console.warn('Railway fallback:', err.message);
        apiRef.result = buildFallback(answers || {});
      })
      .finally(() => {
        apiRef.done = true;
        if (stepRef.current === STAGES.length - 1) finishWithScan();
      });
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>🌙</Text>
        <Text style={s.title}>{typeof COMPLETION.headline === 'function' ? COMPLETION.headline(answers?.name) : COMPLETION.headline}</Text>
        <Text style={s.subtitle}>Our cosmetology engine is reading every signal you shared</Text>

        <View style={s.steps}>
          {STAGES.map((label, i) => {
            const isActive = i === step && !complete;
            const isDone   = i < step || complete;
            return (
              <View key={label} style={[s.step, (isDone || isActive) && s.stepVisible]}>
                <View style={[s.dot, isDone && s.dotDone, isActive && s.dotActive]}>
                  <Text style={s.dotText}>{isDone ? '✓' : isActive ? '◐' : ''}</Text>
                </View>
                <Text style={[s.stepLabel, (isDone || isActive) && { color: C.text }]}>{label}</Text>
                {isActive && <Text style={s.inProgress}>in progress</Text>}
              </View>
            );
          })}
        </View>

        {!complete && scanWaitLabel && (
          <Text style={s.scanWaitLabel}>✨ {scanWaitLabel}</Text>
        )}

        {complete && (
          <View style={s.doneBadge}>
            <Text style={s.doneText}>✓ Analysis complete — revealing your Skin Era</Text>
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
