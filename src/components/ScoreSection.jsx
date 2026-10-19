import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { useTranslation, Trans } from 'react-i18next';
import { dayNumber } from '../lib/scoreReading';

// Top section of the Profile screen: Daniel's "Your skin reading" mockup
// (AI/plans/score-page.md; matched 1:1 in AI/plans/score-page-match.md - the mockup is the
// authority for every look and motion detail here). Numbers come from the PerfectCorp scan
// (analysis.skinScan.signals, RAW scores, server/services/skinScan/signals.js). The written parts -
// "Start here" and each signal's potential / weeks / explanation / shelf / product - come from the
// AI reading (analysis.skinScan.reading) and simply appear once readingStatus is 'ready'.
// AI text is always rendered as plain text, never as HTML.

// Mockup colors.
const P = {
  paper:    '#F5EFE4',
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

// Font stacks as in the mockup ('DM Sans', system-ui, sans-serif). The first name is the app's
// font (src/fonts.css); characters that font does not have (arrows, the small symbols in the
// labels, Hebrew) fall back to the system font like in the mockup, not to the browser's serif.
const SANS = 'DMSans_400Regular, system-ui, sans-serif';
const SANS_MEDIUM = 'DMSans_500Medium, system-ui, sans-serif';
const SERIF = 'CormorantGaramond_500Medium, serif';

// Profile's horizontal padding (ProfileScreen `content` style). The section's paper background
// reaches the screen edges by pulling out by this much (mockup: the whole screen is paper).
const PROFILE_PADDING = 24;

// All visible text lives in src/locales/{en,he}/score.json (namespace "score") and is resolved
// at render time with t() / <Trans>, so it follows the language. The static copy is verbatim from
// the mockup (owner decision D7). No text constants here: a constant would be frozen in the
// language that was active when the file loaded.

// The three explanation blocks inside an open signal card, in mockup order. `label` is a
// translation key (resolved when rendered), never the text itself.
const BLOCKS = [
  { field: 'driver', label: 'score:blocks.driver' },
  { field: 'why',    label: 'score:blocks.why' },
  { field: 'lever',  label: 'score:blocks.lever' },
];

// U+2068 / U+2069 (first-strong isolate) around a value that is interpolated into a sentence, so
// a Latin value (e.g. the English text the AI sends) cannot reorder the surrounding Hebrew.
// Invisible in English.
const isolate = v => '⁨' + v + '⁩';

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// Escapes a text so it can be used literally inside a RegExp.
const escapeRegExp = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Splits plain text into pieces, marking the pieces that equal one of `words`
// (e.g. "lifts your Tone & Radiance" -> ["lifts your ", {bold: "Tone & Radiance"}]).
// Used to bold the signal names inside the AI's "Start here" text, as the mockup does.
function splitOnWords(text, words) {
  const list = words.filter(Boolean);
  if (!list.length) return [text];
  const re = new RegExp(`(${list.map(escapeRegExp).join('|')})`, 'g');
  return text.split(re).filter(Boolean).map(part => (list.includes(part) ? { bold: part } : part));
}

// The mockup's shelf line has a bold start: "Missing:" before a gap, or the first clause of an
// "already own" line ("You already own a niacinamide serum" - use it every night...).
// Returns { lead, rest }: `lead` is bold, `rest` is normal text. For 'own' the lead is the part
// before the first dash (" — " or " - "); without a dash nothing is bold. If the AI text already
// starts with the "Missing:" label, that label is used as the lead instead of adding it twice.
function shelfParts(shelf, missingLabel) {
  if (shelf.status !== 'own') {
    const hasLabel = shelf.text.toLowerCase().startsWith(missingLabel.toLowerCase());
    return { lead: missingLabel, rest: hasLabel ? shelf.text.slice(missingLabel.length) : ` ${shelf.text}` };
  }
  const match = shelf.text.match(/^(.+?)( [—-] .*)$/);
  return match ? { lead: match[1], rest: match[2] } : { lead: null, rest: shelf.text };
}

// Keeps a collapsible part on screen while it animates open or closed (mockup: height + fade).
// Returns { mounted, expanded }: render the part while `mounted`, give it the open styles while
// `expanded`. Opening mounts it closed, then switches to open on the next frames so the CSS
// transition runs; closing switches to closed, then unmounts after `duration` ms so hidden text
// does not stay in the page (screen readers / tests). Without motion it is instant.
function useCollapse(open, duration, reduce) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);

  useEffect(() => {
    if (reduce) { setMounted(open); setExpanded(open); return undefined; }
    if (open) {
      setMounted(true);
      let cancelled = false;
      // Two frames: the first paints the closed state, the second starts the transition.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) setExpanded(true); }));
      return () => { cancelled = true; };
    }
    setExpanded(false);
    const timer = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration, reduce]);

  return { mounted, expanded };
}

// The box that slides open. Its height animates between 0 and the content's natural height with
// the CSS grid trick (one row going from 0fr to 1fr), so long AI text or a rotated screen is never
// cut off and nothing has to be measured. Raw <div>s because the app only runs as a web page
// inside Capacitor and CSS transitions are not React Native styles (same reason as the <svg> rings).
function Collapse({ expanded, reduce, transition, openMarginTop, children }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        opacity: expanded ? 1 : 0,
        marginTop: expanded ? openMarginTop : 0,
        transition: reduce ? 'none' : transition,
      }}
    >
      {/* minHeight 0 lets the row shrink below the content; overflow hides what is outside.
          The inner <View> makes the children behave as in any RN layout (a <Text> directly in a
          plain <div> would be inline: no vertical margins, inherited alignment). */}
      <div style={{ overflow: 'hidden', minHeight: 0 }}><View>{children}</View></div>
    </div>
  );
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
  const { t } = useTranslation();
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
        <Text style={s.dialLabel}>{t('score:baseline')}</Text>
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
  const { t } = useTranslation();
  return (
    <View style={s.potBar}>
      <View style={s.potTrack}>
        <View style={[s.potFill, { width: `${now}%`, backgroundColor: color }]} />
        {/* Striped band (CSS gradient, so a raw <div>). insetInlineStart = left in English,
            right in Hebrew (RTL); the solid edge is on the "possible" end. */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, borderRadius: 8,
          insetInlineStart: `${now}%`, width: `${potential - now}%`,
          background: 'repeating-linear-gradient(45deg,#7C9A8055,#7C9A8055 4px,#7C9A801f 4px,#7C9A801f 8px)',
          borderInlineEnd: `2px solid ${P.good}`, boxSizing: 'border-box',
        }} />
        <View style={[s.potNow, { start: `${now}%` }]} />
      </View>
      <View style={s.potCaps}>
        <Text style={s.potCap}>{t('score:potential.today', { now })}</Text>
        <Text style={[s.potCap, s.potGoal]}>{t('score:potential.possible', { potential })}</Text>
      </View>
    </View>
  );
}

// One of the four signal cards. `copy` is the AI's entry for this signal (or undefined):
// without it the card shows its number only and does not open.
function SignalCard({ signal, copy, reduce }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const body = useCollapse(open, 450, reduce);
  const color = SIGNAL_COLORS[signal.key] || P.clay;
  const hasPotential = typeof copy?.potential === 'number';
  const expandable = Boolean(copy);
  // Only https links (the server already drops anything else) - belt and braces.
  const productUrl = typeof copy?.product?.url === 'string' && copy.product.url.startsWith('https://')
    ? copy.product.url
    : null;
  const shelf = copy?.shelf ? shelfParts(copy.shelf, t('score:shelfMissing')) : null;

  return (
    <Pressable
      // Mockup: on hover the card lifts 1 px and gets a soft shadow (web, mouse only).
      style={({ hovered }) => [s.sig, !reduce && s.sigAnimated, hovered && expandable && s.sigHover]}
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
            {/* Translated by the server's signal key; the server's English name is only a fallback for an unknown key. */}
            <Text style={s.sigName}>{t(`score:signals.${signal.key}`, { defaultValue: signal.name })}</Text>
          </View>
          <Text style={s.sigPotLine}>
            {hasPotential ? (
              // The " -> ~80 possible" part is styled, so <Trans> lets each language place it freely.
              <Trans
                i18nKey="score:signalPotential"
                values={{ score: signal.score, potential: copy.potential, arrow: t('common:arrowNext') }}
                components={{ up: <Text style={s.sigUp} /> }}
              />
            ) : t('score:signalToday', { score: signal.score })}
          </Text>
        </View>
        {expandable && <Chevron open={open} />}
      </View>

      {body.mounted && (
        <Collapse expanded={body.expanded} reduce={reduce} openMarginTop={15}
          transition="grid-template-rows .45s ease, opacity .3s, margin .3s">
          <View style={s.rule} />
          {hasPotential && <PotentialBar now={signal.score} potential={copy.potential} color={color} />}
          {copy.weeks && <Text style={s.horizon}>{t('score:horizon', { weeks: isolate(copy.weeks) })}</Text>}

          {BLOCKS.filter(b => copy[b.field]).map(b => (
            <View key={b.field} style={s.block}>
              <Text style={[s.blockLabel, { color }]}>{t(b.label)}</Text>
              <Text style={s.blockText}>{copy[b.field]}</Text>
            </View>
          ))}

          {shelf && (
            <View style={[s.shelf, copy.shelf.status === 'own' ? s.shelfOwn : s.shelfMiss]}>
              <Text style={s.shelfBadge}>{copy.shelf.status === 'own' ? '✓' : '+'}</Text>
              <Text style={s.shelfText}>
                {shelf.lead && (
                  <Text style={[s.shelfLead, { color: copy.shelf.status === 'own' ? P.good : P.clayDeep }]}>
                    {shelf.lead}
                  </Text>
                )}
                {shelf.rest}
              </Text>
            </View>
          )}

          {copy.product && (
            <View style={s.product}>
              {/* Placeholder thumbnail: the mockup's beige gradient (CSS gradient, so a raw <div>). */}
              <div style={{
                width: 44, height: 52, flex: '0 0 44px', borderRadius: 9, boxSizing: 'border-box',
                background: 'linear-gradient(160deg,#e6dcc8,#d3c3a6)', border: `1px solid ${P.line}`,
              }} />
              <View style={s.productInfo}>
                <Text style={s.productName}>{copy.product.name}</Text>
                {copy.product.actives && <Text style={s.productActives}>{copy.product.actives}</Text>}
              </View>
              {/* "+" is always shown, as in the mockup (owner decision M4/D6). With a valid https
                  link it opens the product page; without one it looks the same but does nothing.
                  It stays an enabled Pressable either way: it takes the tap, so tapping "+" never
                  closes the card (mockup). A disabled Pressable would pass the tap to the card. */}
              <Pressable
                style={s.productAdd}
                onPress={() => productUrl && Linking.openURL(productUrl).catch(() => {})}
                accessibilityRole={productUrl ? 'link' : 'button'}
                accessibilityLabel={t('score:openProduct', { name: isolate(copy.product.name) })}
              >
                <Text style={s.productAddText}>+</Text>
              </Pressable>
            </View>
          )}
        </Collapse>
      )}
    </Pressable>
  );
}

// analysis: the Profile analysis (skinScan, createdAt, firstReadingAt).
// polling: ProfileScreen is still polling the scan (drives the placeholder / skeleton).
export default function ScoreSection({ analysis, polling }) {
  const { t } = useTranslation();
  const [reduce] = useState(prefersReducedMotion);
  const [howOpen, setHowOpen] = useState(false);
  const how = useCollapse(howOpen, 400, reduce);
  const scan = analysis?.skinScan;
  const view = scan?.signals;

  // No scan result yet: a placeholder while Profile polls; nothing once it gave up / failed.
  if (!view) {
    return polling ? (
      <View style={s.placeholder}>
        <Text style={s.placeholderText}>{t('score:reading')}</Text>
      </View>
    ) : null;
  }

  const signals = (view.signals || []).filter(sig => typeof sig.score === 'number');
  if (view.overall == null && !signals.length) return null;

  const reading = scan.readingStatus === 'ready' ? scan.reading : null;
  const copyByKey = Object.fromEntries((reading?.signals || []).map(c => [c.key, c]));
  // The AI copy is still on its way while Profile keeps polling -> skeleton for "Start here".
  const copyLoading = scan.readingStatus === 'pending' && polling;
  const anyExpandable = signals.some(sig => copyByKey[sig.key]);
  const day = dayNumber(analysis.firstReadingAt, analysis.createdAt);
  // The four signal names in the current language, bolded inside the "Start here" text.
  const signalNames = Object.keys(SIGNAL_COLORS).map(key => t(`score:signals.${key}`));

  return (
    <View style={s.section}>
      {/* Hero: eyebrow, title, dial, skin age */}
      <View style={s.hero}>
        <Text style={s.eyebrow}>{t('score:eyebrow', { day })}</Text>
        <Text style={s.title}>{t('score:title')}</Text>
        {view.overall != null && <Dial score={view.overall} />}

        {view.skinAge != null && (
          <>
            <View style={s.ageChip}>
              <View style={s.ageIcon}><Text style={s.ageIconText}>{'◷'}</Text></View>
              <Text style={s.ageLabel}>
                {/* The age number is styled, so <Trans> lets each language place it freely. */}
                <Trans
                  i18nKey="score:skinAge"
                  values={{ age: view.skinAge }}
                  components={{ age: <Text style={s.ageValue} /> }}
                />
              </Text>
            </View>
            <Text style={s.notFixed}>{t('score:notFixed')}</Text>
          </>
        )}

        <Pressable onPress={() => setHowOpen(o => !o)} accessibilityRole="button" hitSlop={8}>
          <Text style={s.howBtn}>{howOpen ? t('score:hide') : t('score:howScored')}</Text>
        </Pressable>
        {how.mounted && (
          <View style={s.howWrap}>
            <Collapse expanded={how.expanded} reduce={reduce} openMarginTop={10}
              transition="grid-template-rows .4s ease, opacity .3s, margin .3s">
              <View style={s.howBody}>
                <Text style={s.howText}>{t('score:howScoredBody')}</Text>
              </View>
            </Collapse>
          </View>
        )}
      </View>

      <View style={s.divider} />

      {/* Start here: the AI's single highest-leverage habit */}
      {reading?.startHere ? (
        <View style={s.startHere}>
          {/* Mockup background: diagonal beige gradient + a soft clay glow in the top corner
              (CSS gradients, so raw <div>s; insetInlineEnd = right in English, left in Hebrew). */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,#EDE3D2,#E8DBC5)' }} />
          <div aria-hidden="true" style={{
            position: 'absolute', top: -30, insetInlineEnd: -30, width: 110, height: 110, borderRadius: '50%',
            background: 'radial-gradient(circle,#B86B4B22,transparent 70%)',
          }} />
          <View style={s.startTag}><Text style={s.startTagText}>{t('score:startHere')}</Text></View>
          <Text style={s.startTitle}>{reading.startHere.title}</Text>
          <Text style={s.startBody}>
            {splitOnWords(reading.startHere.body, signalNames).map((part, i) => (
              typeof part === 'string' ? part : <Text key={i} style={s.startBold}>{part.bold}</Text>
            ))}
          </Text>
          <Text style={s.startImpact}>{t('score:leverage')}</Text>
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
          <Text style={s.secTitle}>{t('score:signalsTitle')}</Text>
          <Text style={s.secSub}>
            {t('score:signalsIntro')}{anyExpandable ? ` ${t('score:signalsTap')}` : ''}
          </Text>
          {signals.map(sig => <SignalCard key={sig.key} signal={sig} copy={copyByKey[sig.key]} reduce={reduce} />)}
        </>
      )}

      <Text style={s.footnote}>{t('score:footnote')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // Paper background from screen edge to screen edge (negative margin = Profile's padding),
  // with the mockup's own 22 px side padding inside.
  section:     { marginHorizontal: -PROFILE_PADDING, paddingHorizontal: 22, paddingTop: 6, paddingBottom: 28, backgroundColor: P.paper, marginBottom: 26 },
  placeholder: { backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 18, paddingVertical: 22, alignItems: 'center', marginBottom: 20 },
  placeholderText: { fontFamily: SANS, fontSize: 13, color: P.inkSoft, fontStyle: 'italic' },

  hero:      { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  eyebrow:   { fontFamily: SANS_MEDIUM, fontSize: 11, letterSpacing: 2.86, textTransform: 'uppercase', color: P.clay, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  title:     { fontFamily: SANS_MEDIUM, fontSize: 15, letterSpacing: 0.3, color: P.inkSoft, fontWeight: '600', marginBottom: 14, textAlign: 'center' },

  dial:       { width: 168, height: 168, position: 'relative' },
  dialCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dialNum:    { fontFamily: SERIF, fontSize: 60, lineHeight: 54, fontWeight: '600', color: P.ink },
  dialLabel:  { fontFamily: SANS, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: P.inkFaint, marginTop: 4 },

  ageChip:    { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16, backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 100, paddingVertical: 8, paddingStart: 12, paddingEnd: 16, boxShadow: '0 8px 20px -16px rgba(60,44,30,.5)' },
  ageIcon:    { width: 26, height: 26, borderRadius: 13, backgroundColor: P.resil + '22', alignItems: 'center', justifyContent: 'center' },
  ageIconText:{ fontFamily: SANS, fontSize: 14, color: P.resil },
  ageLabel:   { fontFamily: SANS, fontSize: 12.5, color: P.inkSoft },
  ageValue:   { fontFamily: SERIF, fontSize: 17, color: P.ink, fontWeight: '600', marginStart: 2 },
  notFixed:   { fontFamily: SANS, fontSize: 11.5, color: P.inkFaint, marginTop: 8, fontStyle: 'italic', textAlign: 'center' },

  howBtn:     { fontFamily: SANS, fontSize: 11.5, color: P.clayDeep, textDecorationLine: 'underline', marginTop: 12, marginBottom: 2 },
  howWrap:    { alignSelf: 'stretch' },
  howBody:    { backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 15 },
  howText:    { fontFamily: SANS, fontSize: 11.5, color: P.inkSoft, lineHeight: 17.8 },

  divider:    { height: 1, backgroundColor: P.line, marginTop: 20, marginBottom: 16 },

  // position + overflow: the gradient layers are absolutely positioned inside and the corner glow
  // is clipped by the rounded border, as in the mockup.
  startHere:  { position: 'relative', overflow: 'hidden', backgroundColor: '#EAE0CD', borderWidth: 1.5, borderColor: P.clay + '55', borderRadius: 20, padding: 18, marginBottom: 22 },
  startTag:   { position: 'relative', alignSelf: 'flex-start', backgroundColor: P.clay, borderRadius: 100, paddingVertical: 4, paddingHorizontal: 11 },
  startTagText:{ fontFamily: SANS_MEDIUM, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', color: '#FFF' },
  startTitle: { position: 'relative', fontFamily: SERIF, fontSize: 26, fontWeight: '600', lineHeight: 27, color: P.ink, marginTop: 10, marginBottom: 6 },
  startBody:  { position: 'relative', fontFamily: SANS, fontSize: 13, color: P.inkSoft, lineHeight: 20 },
  startBold:  { color: P.ink, fontWeight: '600' },
  startImpact:{ position: 'relative', fontFamily: SANS_MEDIUM, fontSize: 11.5, color: P.clayDeep, fontWeight: '600', marginTop: 12 },
  skeletonCard:{ gap: 10 },
  skeletonLine:{ height: 9, borderRadius: 5, backgroundColor: P.line },

  secTitle:   { fontFamily: SANS_MEDIUM, fontSize: 13, letterSpacing: 0.26, color: P.inkSoft, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  secSub:     { fontFamily: SANS, fontSize: 12, color: P.inkFaint, lineHeight: 18, marginBottom: 14 },

  sig:        { backgroundColor: P.card, borderWidth: 1, borderColor: P.line, borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 12 },
  sigAnimated:{ transitionProperty: 'box-shadow, transform', transitionDuration: '250ms' },
  sigHover:   { boxShadow: '0 14px 30px -22px rgba(60,44,30,.55)', transform: [{ translateY: -1 }] },
  sigTop:     { flexDirection: 'row', alignItems: 'center', gap: 13 },
  sigArc:     { width: 50, height: 50, position: 'relative' },
  sigArcCenter:{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  sigArcValue:{ fontFamily: SERIF, fontSize: 20, fontWeight: '600' },
  sigMid:     { flex: 1, minWidth: 0 },
  sigNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sigIcon:    { width: 12, height: 12, borderRadius: 3 },
  sigName:    { fontFamily: SANS_MEDIUM, fontSize: 14.5, fontWeight: '600', color: P.ink },
  sigPotLine: { fontFamily: SANS, fontSize: 11.5, color: P.inkSoft, marginTop: 3 },
  sigUp:      { color: P.good, fontWeight: '700' },

  rule:       { height: 1, backgroundColor: P.line, marginBottom: 14 },

  potBar:     { marginBottom: 16 },
  potTrack:   { height: 8, borderRadius: 8, backgroundColor: P.paper2, position: 'relative' },
  potFill:    { position: 'absolute', start: 0, top: 0, bottom: 0, borderRadius: 8 },
  potNow:     { position: 'absolute', top: -2.5, width: 13, height: 13, marginStart: -6.5, borderRadius: 7, backgroundColor: '#FFF', borderWidth: 3, borderColor: P.ink, zIndex: 2 },
  potCaps:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  potCap:     { fontFamily: SANS, fontSize: 10.5, color: P.inkFaint },
  potGoal:    { color: P.good, fontWeight: '600' },
  // As the mockup renders it: page-size text in ink, start-aligned (its smaller italic style is
  // never applied there), pulled 6 px up under the bar.
  horizon:    { fontFamily: SANS, fontSize: 16, lineHeight: 21, color: P.ink, marginTop: -6, marginBottom: 16 },

  block:      { marginBottom: 13 },
  blockLabel: { fontFamily: SANS_MEDIUM, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '700', marginBottom: 5 },
  blockText:  { fontFamily: SANS, fontSize: 12.5, color: P.inkSoft, lineHeight: 18.75 },

  shelf:      { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 13, backgroundColor: P.paper },
  shelfOwn:   { backgroundColor: P.good + '18' },
  shelfMiss:  { backgroundColor: P.clay + '15' },
  shelfBadge: { fontFamily: SANS, fontSize: 15, color: P.ink, marginTop: 1 },
  shelfText:  { flex: 1, fontFamily: SANS, fontSize: 12.5, lineHeight: 18.1, color: P.ink },
  shelfLead:  { fontWeight: '600' },

  product:    { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: P.cardHi, borderWidth: 1, borderColor: P.line, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13 },
  productInfo:{ flex: 1, minWidth: 0 },
  productName:{ fontFamily: SANS_MEDIUM, fontSize: 13, fontWeight: '600', color: P.ink },
  productActives:{ fontFamily: SANS, fontSize: 11, color: P.inkFaint, marginTop: 2 },
  productAdd: { width: 30, height: 30, borderRadius: 15, backgroundColor: P.ink, alignItems: 'center', justifyContent: 'center' },
  productAddText:{ fontFamily: SANS, fontSize: 18, lineHeight: 20, color: '#F5EFE4' },

  footnote:   { fontFamily: SANS, fontSize: 10.5, color: P.inkFaint, textAlign: 'center', lineHeight: 15.75, marginTop: 18, fontStyle: 'italic', paddingHorizontal: 6 },
});
