import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { dayNumber } from '../lib/scoreReading';

// Top section of the Profile screen: Daniel's "Your skin reading" mockup
// (AI/plans/score-page.md). Numbers come from the PerfectCorp scan (analysis.skinScan.signals,
// RAW scores, server/services/skinScan/signals.js). The written parts - "Start here" and each
// signal's potential / weeks / explanation / shelf / product - come from Railway
// (analysis.skinScan.reading) and simply appear once readingStatus is 'ready'.
// Railway text is always rendered as plain text, never as HTML.

// Mockup colors.
const P = {
  paper2:   '#EEE5D6',
  card:     '#FBF7EF',
  cardHi:   '#FCF4E7',
  ink:      '#2B2621',
  inkSoft:  '#6E6357',
  inkFaint: '#9A8E7F',
  line:     '#E2D6C2',
  clay:     '#B86B4B',
  clayDeep: '#9E5942',
  good:     '#7C9A80',
  resil:    '#A5738A',
};
const SIGNAL_COLORS = {
  barrier: '#7C9A92', clarity: '#B8734F', tone: '#C39A57', resilience: '#A5738A',
};

// Non-ASCII characters of the mockup copy, spelled as escapes to keep this file ASCII.
const DOT = '·';      // middle dot
const DASH = '—';     // em dash
const ARROW = '→';    // ->
const UP = '↗';       // north-east arrow
const ELLIPSIS = '…';

// Static copy, verbatim from the mockup (owner decision D7).
const COPY = {
  title: 'Where your skin is speaking from today',
  baseline: 'Baseline',
  notFixed: `Not fixed ${DASH} this comes down as your signals rise.`,
  howScored: 'How is this scored?',
  howScoredBody: `Your reading blends an objective read of your selfie with what you told us in your quiz. It's a starting line to move from ${DASH} not a grade. We show your true score, never an inflated one.`,
  leverage: `${UP} Your single highest-leverage move`,
  signalsTitle: 'Your four signals',
  signalsIntro: `Not scores to raise for their own sake ${DASH} each one has something dragging it, and something that moves it.`,
  signalsTap: 'Tap to see how far it can go.',
  footnote: `Projections show what's typically possible with consistent use over the time shown ${DASH} not a guarantee, and not past history. This is a self-care reading, not a medical diagnosis.`,
  reading: `Reading your skin${ELLIPSIS}`,
};

// The three explanation blocks inside an open signal card, in mockup order.
const BLOCKS = [
  { field: 'driver', label: `◔ What's dragging it` },
  { field: 'why',    label: '✦ Why (from your quiz)' },
  { field: 'lever',  label: `${UP} What moves it` },
];

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// A progress ring (inline SVG: the app only runs as a web page inside Capacitor, and the
// .web.jsx screens already use DOM elements). value 0-100; starts at 12 o'clock.
function Ring({ size, radius, stroke, value, color, animated }) {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value || 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"
      style={{ transform: 'rotate(-90deg)', display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={P.line} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        style={animated ? { transition: 'stroke-dashoffset 1.3s cubic-bezier(.2,.7,.2,1)' } : undefined}
      />
    </svg>
  );
}

// The big overall-score dial: the arc sweeps in and the number counts up (1.2 s ease-out),
// both skipped when the device asks for reduced motion.
function Dial({ score }) {
  const [reduce] = useState(prefersReducedMotion);
  const [shown, setShown] = useState(reduce ? score : 0);
  const [arcValue, setArcValue] = useState(reduce ? score : 0);

  useEffect(() => {
    if (reduce) { setShown(score); setArcValue(score); return undefined; }
    // Arc: start empty, then move to the score so the CSS transition animates it.
    const arcTimer = setTimeout(() => setArcValue(score), 200);
    // Number: ease-out cubic count-up on animation frames.
    let frame;
    let start = null;
    const tick = t => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / 1200);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { clearTimeout(arcTimer); cancelAnimationFrame(frame); };
  }, [score, reduce]);

  return (
    <View style={s.dial}>
      <Ring size={168} radius={74} stroke={9} value={arcValue} color={P.clay} animated={!reduce} />
      <View style={s.dialCenter}>
        <Text style={s.dialNum}>{shown}</Text>
        <Text style={s.dialLabel}>{COPY.baseline}</Text>
      </View>
    </View>
  );
}

// Down-pointing chevron; turned upside down while the card is open.
function Chevron({ open }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .3s', flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" stroke={P.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Today vs. "possible" bar: filled to today's score, striped band up to the potential.
function PotentialBar({ now, potential, color }) {
  return (
    <View style={s.potBar}>
      <View style={s.potTrack}>
        <View style={[s.potFill, { width: `${now}%`, backgroundColor: color }]} />
        {/* start = left in English, right in Hebrew (RTL) */}
        <View style={[s.potBand, { start: `${now}%`, width: `${potential - now}%` }]} />
        <View style={[s.potNow, { start: `${now}%` }]} />
      </View>
      <View style={s.potCaps}>
        <Text style={s.potCap}>Today {DOT} {now}</Text>
        <Text style={[s.potCap, s.potGoal]}>Possible {DOT} ~{potential}</Text>
      </View>
    </View>
  );
}

// One of the four signal cards. `copy` is Railway's entry for this signal (or undefined):
// without it the card shows its number only and does not open.
function SignalCard({ signal, copy }) {
  const [open, setOpen] = useState(false);
  const color = SIGNAL_COLORS[signal.key] || P.clay;
  const hasPotential = typeof copy?.potential === 'number';
  const expandable = Boolean(copy);
  // Only https links (the server already drops anything else) - belt and braces.
  const productUrl = typeof copy?.product?.url === 'string' && copy.product.url.startsWith('https://')
    ? copy.product.url
    : null;

  return (
    <Pressable
      style={s.sig}
      onPress={() => expandable && setOpen(o => !o)}
      disabled={!expandable}
      accessibilityRole={expandable ? 'button' : undefined}
      // react-native-web 0.21 no longer renders accessibilityState; aria-expanded it does.
      aria-expanded={expandable ? open : undefined}
    >
      <View style={s.sigTop}>
        <View style={s.sigArc}>
          <Ring size={50} radius={21} stroke={4} value={signal.score} color={color} />
          <View style={s.sigArcCenter}>
            <Text style={[s.sigArcValue, { color }]}>{signal.score}</Text>
          </View>
        </View>
        <View style={s.sigMid}>
          <View style={s.sigNameRow}>
            <View style={[s.sigIcon, { backgroundColor: color }]} />
            <Text style={s.sigName}>{signal.name}</Text>
          </View>
          <Text style={s.sigPotLine}>
            Today {signal.score}
            {hasPotential && <Text style={s.sigUp}>{` ${ARROW} ~${copy.potential} possible`}</Text>}
          </Text>
        </View>
        {expandable && <Chevron open={open} />}
      </View>

      {open && (
        <View style={s.sigBody}>
          <View style={s.rule} />
          {hasPotential && <PotentialBar now={signal.score} potential={copy.potential} color={color} />}
          {copy.weeks && <Text style={s.horizon}>typically {copy.weeks} with consistency</Text>}

          {BLOCKS.filter(b => copy[b.field]).map(b => (
            <View key={b.field} style={s.block}>
              <Text style={[s.blockLabel, { color }]}>{b.label}</Text>
              <Text style={s.blockText}>{copy[b.field]}</Text>
            </View>
          ))}

          {copy.shelf && (
            <View style={[s.shelf, copy.shelf.status === 'own' ? s.shelfOwn : s.shelfMiss]}>
              <Text style={[s.shelfBadge, { color: copy.shelf.status === 'own' ? P.good : P.clayDeep }]}>
                {copy.shelf.status === 'own' ? '✓' : '+'}
              </Text>
              <Text style={s.shelfText}>{copy.shelf.text}</Text>
            </View>
          )}

          {copy.product && (
            <View style={s.product}>
              <View style={s.productThumb} />
              <View style={s.productInfo}>
                <Text style={s.productName}>{copy.product.name}</Text>
                {copy.product.actives && <Text style={s.productActives}>{copy.product.actives}</Text>}
              </View>
              {/* "+" opens the product page (owner decision); hidden without a valid link. */}
              {productUrl && (
                <Pressable
                  style={s.productAdd}
                  onPress={() => Linking.openURL(productUrl).catch(() => {})}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${copy.product.name}`}
                >
                  <Text style={s.productAddText}>+</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

// analysis: the Profile analysis (skinScan, createdAt, firstReadingAt).
// polling: ProfileScreen is still polling the scan (drives the placeholder / skeleton).
export default function ScoreSection({ analysis, polling }) {
  const [howOpen, setHowOpen] = useState(false);
  const scan = analysis?.skinScan;
  const view = scan?.signals;

  // No scan result yet: a placeholder while Profile polls; nothing once it gave up / failed.
  if (!view) {
    return polling ? (
      <View style={s.placeholder}>
        <Text style={s.placeholderText}>{COPY.reading}</Text>
      </View>
    ) : null;
  }

  const signals = (view.signals || []).filter(sig => typeof sig.score === 'number');
  if (view.overall == null && !signals.length) return null;

  const reading = scan.readingStatus === 'ready' ? scan.reading : null;
  const copyByKey = Object.fromEntries((reading?.signals || []).map(c => [c.key, c]));
  // Railway's copy is still on its way while Profile keeps polling -> skeleton for "Start here".
  const copyLoading = scan.readingStatus === 'pending' && polling;
  const anyExpandable = signals.some(sig => copyByKey[sig.key]);
  const day = dayNumber(analysis.firstReadingAt, analysis.createdAt);

  return (
    <View style={s.section}>
      {/* Hero: eyebrow, title, dial, skin age */}
      <View style={s.hero}>
        <Text style={s.eyebrow}>Your skin reading {DOT} Day {day}</Text>
        <Text style={s.title}>{COPY.title}</Text>
        {view.overall != null && <Dial score={view.overall} />}

        {view.skinAge != null && (
          <>
            <View style={s.ageChip}>
              <View style={s.ageIcon}><Text style={s.ageIconText}>{'◷'}</Text></View>
              <Text style={s.ageLabel}>Skin age <Text style={s.ageValue}>{view.skinAge}</Text></Text>
            </View>
            <Text style={s.notFixed}>{COPY.notFixed}</Text>
          </>
        )}

        <Pressable onPress={() => setHowOpen(o => !o)} accessibilityRole="button" hitSlop={8}>
          <Text style={s.howBtn}>{howOpen ? 'Hide' : COPY.howScored}</Text>
        </Pressable>
        {howOpen && (
          <View style={s.howBody}>
            <Text style={s.howText}>{COPY.howScoredBody}</Text>
          </View>
        )}
      </View>

      <View style={s.divider} />

      {/* Start here: Railway's single highest-leverage habit */}
      {reading?.startHere ? (
        <View style={s.startHere}>
          <View style={s.startTag}><Text style={s.startTagText}>Start here</Text></View>
          <Text style={s.startTitle}>{reading.startHere.title}</Text>
          <Text style={s.startBody}>{reading.startHere.body}</Text>
          <Text style={s.startImpact}>{COPY.leverage}</Text>
        </View>
      ) : copyLoading ? (
        <View style={[s.startHere, s.skeletonCard]}>
          <View style={[s.skeletonLine, { width: '30%' }]} />
          <View style={[s.skeletonLine, { width: '70%', height: 14 }]} />
          <View style={[s.skeletonLine, { width: '90%' }]} />
        </View>
      ) : null}

      {/* The four signals */}
      {signals.length > 0 && (
        <>
          <Text style={s.secTitle}>{COPY.signalsTitle}</Text>
          <Text style={s.secSub}>
            {COPY.signalsIntro}{anyExpandable ? ` ${COPY.signalsTap}` : ''}
          </Text>
          {signals.map(sig => <SignalCard key={sig.key} signal={sig} copy={copyByKey[sig.key]} />)}
        </>
      )}

      <Text style={s.footnote}>{COPY.footnote}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  section:     { marginBottom: 26 },
  placeholder: { backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 18, paddingVertical: 22, alignItems: 'center', marginBottom: 20 },
  placeholderText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: P.inkSoft, fontStyle: 'italic' },

  hero:      { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  eyebrow:   { fontFamily: 'DMSans_500Medium', fontSize: 11, letterSpacing: 2.8, textTransform: 'uppercase', color: P.clay, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  title:     { fontFamily: 'DMSans_500Medium', fontSize: 15, color: P.inkSoft, fontWeight: '600', marginBottom: 14, textAlign: 'center' },

  dial:       { width: 168, height: 168, position: 'relative' },
  dialCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dialNum:    { fontFamily: 'CormorantGaramond_500Medium', fontSize: 60, lineHeight: 56, fontWeight: '600', color: P.ink },
  dialLabel:  { fontFamily: 'DMSans_400Regular', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: P.inkFaint, marginTop: 4 },

  ageChip:    { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16, backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 100, paddingVertical: 8, paddingStart: 12, paddingEnd: 16 },
  ageIcon:    { width: 26, height: 26, borderRadius: 13, backgroundColor: P.resil + '22', alignItems: 'center', justifyContent: 'center' },
  ageIconText:{ fontSize: 14, color: P.resil },
  ageLabel:   { fontFamily: 'DMSans_400Regular', fontSize: 12.5, color: P.inkSoft },
  ageValue:   { fontFamily: 'CormorantGaramond_500Medium', fontSize: 17, color: P.ink, fontWeight: '600' },
  notFixed:   { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: P.inkFaint, marginTop: 8, fontStyle: 'italic', textAlign: 'center' },

  howBtn:     { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: P.clayDeep, textDecorationLine: 'underline', marginTop: 12, marginBottom: 2 },
  howBody:    { alignSelf: 'stretch', marginTop: 10, backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 15 },
  howText:    { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: P.inkSoft, lineHeight: 18 },

  divider:    { height: 1, backgroundColor: P.line, marginTop: 20, marginBottom: 16 },

  startHere:  { backgroundColor: '#EAE0CD', borderWidth: 1.5, borderColor: P.clay + '55', borderRadius: 20, padding: 18, marginBottom: 22 },
  startTag:   { alignSelf: 'flex-start', backgroundColor: P.clay, borderRadius: 100, paddingVertical: 4, paddingHorizontal: 11 },
  startTagText:{ fontFamily: 'DMSans_500Medium', fontSize: 10, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: '#FFF' },
  startTitle: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, fontWeight: '600', color: P.ink, marginTop: 10, marginBottom: 6 },
  startBody:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: P.inkSoft, lineHeight: 20 },
  startImpact:{ fontFamily: 'DMSans_500Medium', fontSize: 11.5, color: P.clayDeep, fontWeight: '600', marginTop: 12 },
  skeletonCard:{ gap: 10 },
  skeletonLine:{ height: 9, borderRadius: 5, backgroundColor: P.line },

  secTitle:   { fontFamily: 'DMSans_500Medium', fontSize: 13, color: P.inkSoft, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  secSub:     { fontFamily: 'DMSans_400Regular', fontSize: 12, color: P.inkFaint, lineHeight: 18, marginBottom: 14 },

  sig:        { backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 12 },
  sigTop:     { flexDirection: 'row', alignItems: 'center', gap: 13 },
  sigArc:     { width: 50, height: 50, position: 'relative' },
  sigArcCenter:{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  sigArcValue:{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 20, fontWeight: '600' },
  sigMid:     { flex: 1, minWidth: 0 },
  sigNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sigIcon:    { width: 12, height: 12, borderRadius: 3 },
  sigName:    { fontFamily: 'DMSans_500Medium', fontSize: 14.5, fontWeight: '600', color: P.ink },
  sigPotLine: { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: P.inkSoft, marginTop: 3 },
  sigUp:      { color: P.good, fontWeight: '700' },

  sigBody:    { marginTop: 15 },
  rule:       { height: 1, backgroundColor: P.line, marginBottom: 14 },

  potBar:     { marginBottom: 10 },
  potTrack:   { height: 8, borderRadius: 8, backgroundColor: P.paper2, position: 'relative' },
  potFill:    { position: 'absolute', start: 0, top: 0, bottom: 0, borderRadius: 8 },
  potBand:    { position: 'absolute', top: 0, bottom: 0, borderRadius: 8, backgroundColor: P.good + '40', borderEndWidth: 2, borderEndColor: P.good }, // borderEnd = right border in English, left in Hebrew
  potNow:     { position: 'absolute', top: -2.5, width: 13, height: 13, marginStart: -6.5, borderRadius: 7, backgroundColor: '#FFF', borderWidth: 3, borderColor: P.ink, zIndex: 2 },
  potCaps:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  potCap:     { fontFamily: 'DMSans_400Regular', fontSize: 10.5, color: P.inkFaint },
  potGoal:    { color: P.good, fontWeight: '600' },
  horizon:    { fontFamily: 'DMSans_400Regular', fontSize: 11, color: P.inkSoft, fontStyle: 'italic', textAlign: 'center', marginBottom: 16 },

  block:      { marginBottom: 13 },
  blockLabel: { fontFamily: 'DMSans_500Medium', fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '700', marginBottom: 5 },
  blockText:  { fontFamily: 'DMSans_400Regular', fontSize: 12.5, color: P.inkSoft, lineHeight: 19 },

  shelf:      { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 13 },
  shelfOwn:   { backgroundColor: P.good + '18' },
  shelfMiss:  { backgroundColor: P.clay + '15' },
  shelfBadge: { fontSize: 15, fontWeight: '700', marginTop: 1 },
  shelfText:  { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12.5, lineHeight: 18, color: P.ink },

  product:    { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: P.cardHi, borderWidth: 1, borderColor: P.line, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13 },
  productThumb:{ width: 44, height: 52, borderRadius: 9, backgroundColor: '#DDD0B8', borderWidth: 1, borderColor: P.line },
  productInfo:{ flex: 1, minWidth: 0 },
  productName:{ fontFamily: 'DMSans_500Medium', fontSize: 13, fontWeight: '600', color: P.ink },
  productActives:{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: P.inkFaint, marginTop: 2 },
  productAdd: { width: 30, height: 30, borderRadius: 15, backgroundColor: P.ink, alignItems: 'center', justifyContent: 'center' },
  productAddText:{ fontSize: 18, lineHeight: 20, color: '#F5EFE4' },

  footnote:   { fontFamily: 'DMSans_400Regular', fontSize: 10.5, color: P.inkFaint, textAlign: 'center', lineHeight: 16, marginTop: 18, fontStyle: 'italic', paddingHorizontal: 6 },
});
