import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { pollScan } from '../lib/skinScan';
import FallbackBanner from '../components/FallbackBanner';
import ScoreSection from '../components/ScoreSection';
import { MenuButton } from '../components/SideMenu';
import { eraText, analysisAffirmation } from '../lib/eraText';
import { fetchBookingConfig, fetchMine } from '../lib/bookingApi';
import { getWelcomeRef, CONSULTATION_REF } from '../lib/welcomeVariants';

// U+2068 / U+2069 (first-strong isolate) around a value interpolated into a sentence, so a Latin
// value cannot reorder the surrounding Hebrew. Invisible in English.
const isolate = v => '\u2068' + v + '\u2069';

export default function ProfileScreen({ navigation, route }) {
  // t() resolves text at render time, so it follows the current language.
  const { t, i18n } = useTranslation();
  const {
    analysis, setAnalysis, answers, user, analysisSaveFailed, setAnalysisSaveFailed,
  } = useApp();
  // Opened from Home (the "My skin profile" header button or the "View my full analysis"
  // card), not from the quiz reveal.
  const openedFromHome = Boolean(route?.params?.fromHome);
  const era = analysis?.era;
  // The scan is "settled" once its result is in AND the score-reading copy is no longer
  // on its way (readingStatus 'ready' / 'failed' / 'unavailable'). Until then we poll.
  const scanSettled = Boolean(analysis?.skinScan) && analysis.skinScan.readingStatus !== 'pending';
  // True while the loop below is running: the score section then shows its
  // "Reading your skin..." placeholder / copy skeleton instead of hiding them.
  const [scanPolling, setScanPolling] = useState(() => Boolean(analysis?.skinScanId || answers?.skinScanId));

  useEffect(() => {
    const scanId = analysis?.skinScanId || answers?.skinScanId;
    const scanToken = answers?.skinScanToken;
    if (!scanId || scanSettled) { setScanPolling(false); return; }
    let cancelled = false;
    let attempts = 0;
    setScanPolling(true);

    async function refreshScan() {
      const result = await pollScan(scanId, scanToken);
      if (cancelled) return;
      if (result?.status === 'complete' && result.skinScan) {
        // Always take the fresh copy: signals now, and the reading once score reading answers.
        setAnalysis(current => current ? { ...current, skinScanId: scanId, skinScan: result.skinScan } : current);
        // Keep polling (same loop and attempt cap) while the copy is still on its way.
        if (result.skinScan.readingStatus !== 'pending') { setScanPolling(false); return; }
      } else if (result?.status === 'failed') {
        setScanPolling(false);
        return;
      }
      // Gave up: the section keeps what it has (numbers only, or nothing without a scan).
      if (attempts >= 30) { setScanPolling(false); return; }
      attempts += 1;
      setTimeout(refreshScan, 2000);
    }
    refreshScan();
    return () => { cancelled = true; };
    // Depends on scanSettled rather than the skinScan object, so a 'pending' result does not
    // restart this loop (and its attempt cap) on every poll.
  }, [analysis?.skinScanId, scanSettled, answers?.skinScanId, answers?.skinScanToken]);

  // "Book a consultation" button under the main button: every skin analysis ends with the option
  // to book (plan AI/plans/shopify-consultation-link.md, D2/D5). Hidden (false) until we know:
  //  - signed out: shown, EXCEPT for the Shopify link (?ref=consultation) - those customers already
  //    paid for a consultation. (Booking needs an account, so the tap goes through SignUp.)
  //  - signed in: shown when booking is switched on AND the server says canBook (no upcoming in-app
  //    booking and no Shopify appointment that has not ended yet).
  //  - any network error: not shown (the side menu still has "Book a consultation").
  const [showBook, setShowBook] = useState(false);
  useEffect(() => {
    if (!user) { setShowBook(getWelcomeRef() !== CONSULTATION_REF); return undefined; }
    let cancelled = false;
    Promise.all([fetchBookingConfig(), fetchMine()]).then(
      ([config, mine]) => { if (!cancelled) setShowBook(Boolean(config?.enabled) && mine?.canBook === true); },
      () => { if (!cancelled) setShowBook(false); },
    );
    return () => { cancelled = true; };
  }, [user]);

  if (!analysis) return null;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: era.bg }]}>
      <ScrollView contentContainerStyle={s.content}>

        {/* Menu button only when opened from Home / the menu; the first view after the quiz has no menu. */}
        {openedFromHome && (
          <View style={s.menuRow}>
            <MenuButton onPress={navigation.openMenu} color={era.color} />
          </View>
        )}

        {analysisSaveFailed && (
          <View style={s.saveWarnBanner}>
            <Text style={s.saveWarnText}>
              {t('profile:saveFailed')}
            </Text>
            <Pressable onPress={() => setAnalysisSaveFailed(false)} hitSlop={8}>
              <Text style={s.saveWarnDismiss}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Generic-result warning + Try again / Retake (renders nothing for real results) */}
        <FallbackBanner analysis={analysis} navigation={navigation} />

        {/* Score section: overall score, skin age, "Start here" and the four signals
            (PerfectCorp scan + generated copy). Replaces the old "AI Skin Scan" card. */}
        <ScoreSection analysis={analysis} polling={scanPolling} />

        {/* Era hero */}
        <View style={s.eraHero}>
          <Text style={s.eraEmoji}>{era.emoji}</Text>
          <Text style={s.eraEyebrow}>{t('profile:eraEyebrow')}</Text>
          <Text style={[s.eraName, { color: era.color }]}>{eraText(era, 'name', i18n.language)}</Text>
          <Text style={s.eraTagline}>"{eraText(era, 'tagline', i18n.language)}"</Text>
        </View>
        <View style={[s.divider, { backgroundColor: era.color + '30' }]} />

        {/* Analysis */}
        <View style={s.card}>
          <Text style={s.cardLabel}>{t('profile:analysisTitle')}</Text>
          <Text style={s.cardBody}>{analysis.skinAnalysis}</Text>
        </View>

        {!!analysis.safetyFlags?.length && (
          <View style={s.safetyCard} accessibilityRole="summary">
            <Text style={s.safetyTitle}>{t('profile:safety.title')}</Text>
            {analysis.safetyFlags.map((flag, index) => (
              <Text key={`${index}-${flag}`} style={s.safetyText}>• {flag}</Text>
            ))}
          </View>
        )}

        {/* Key Insights */}
        <Text style={s.sectionLabel}>{t('profile:insightsTitle')}</Text>
        <View style={s.insightList}>
          {(analysis.keyInsights || []).map((ins, i) => (
            <View key={i} style={s.insightRow}>
              <View style={[s.insightNum, { backgroundColor: era.color + '20' }]}>
                <Text style={[s.insightNumText, { color: era.color }]}>{i + 1}</Text>
              </View>
              <Text style={s.insightText}>{ins}</Text>
            </View>
          ))}
        </View>

        {/* Products moved to their own screen (My products): audit, SR ritual, shelf and market picks. */}
        <Pressable
          testID="profile-my-products-link"
          onPress={() => navigation.navigate('MyProducts')}
          accessibilityRole="link"
          style={[s.productsLink, { borderColor: era.color + '40' }]}
        >
          <Text style={[s.productsLinkText, { color: era.color }]}>{t('profile:myProductsLink')}</Text>
        </Pressable>

        {/* Affirmation */}
        <View style={[s.affirmation, { borderColor: era.color + '50' }]}>
          <Text style={s.affirmLabel}>{t('profile:affirmLabel')}</Text>
          {/* The affirmation is usually AI text (English), so it is isolated inside the quotes. */}
          <Text style={[s.affirmText, { color: era.color }]}>"{isolate(analysisAffirmation(analysis, i18n.language))}"</Text>
        </View>

        <Pressable
          style={[s.cta, { backgroundColor: era.color }]}
          // The routine (Home) always needs an account:
          //  - no user (took the quiz signed out)     -> SignUp, which saves this analysis;
          //  - signed in, SkinTiming never answered    -> first-time onboarding chain;
          //  - signed in and onboarded (e.g. a retake) -> straight to Home.
          //  - opened from Home ("My skin profile" button or "View my full analysis" card)
          //    -> just go back to that Home (navigating would stack a second Home on top).
          onPress={() => (openedFromHome
            ? navigation.goBack()
            : navigation.navigate(!user ? 'SignUp' : user.skincareTiming ? 'Home' : 'SkinTiming'))}
        >
          <Text style={s.ctaText}>{t('profile:cta')}</Text>
        </Pressable>
        <Text style={s.ctaHint}>{t('profile:ctaHint')}</Text>

        {showBook && (
          <Pressable
            testID="profile-book-consultation"
            accessibilityRole="button"
            style={[s.bookBtn, { borderColor: era.color }]}
            // Signed out: SignUp first (it saves this analysis), then the Booking screen.
            onPress={() => (user ? navigation.navigate('Booking') : navigation.navigate('SignUp', { next: 'Booking' }))}
          >
            <Text style={[s.bookBtnText, { color: era.color }]}>{t('profile:bookCta')}</Text>
          </Pressable>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1 },
  content:   { padding: 24, paddingTop: 28 },
  menuRow:   { flexDirection: 'row', marginBottom: 16 },
  saveWarnBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FBEEE9', borderWidth: 1, borderColor: '#E4B7A6', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 18 },
  saveWarnText:   { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#9A5B44', lineHeight: 17 },
  saveWarnDismiss:{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#9A5B44' },

  eraHero:   { alignItems: 'center', marginBottom: 22 },
  eraEmoji:  { fontSize: 54, marginBottom: 14 },
  eraEyebrow:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 6 },
  eraName:   { fontFamily: 'CormorantGaramond_500Medium', fontSize: 24, lineHeight: 31, textAlign: 'center' },
  eraTagline:{ fontFamily: 'CormorantGaramond_400Regular', fontSize: 14, color: '#6B5E57', fontStyle: 'italic', marginTop: 8, lineHeight: 22, textAlign: 'center' },
  divider:   { height: 1, marginBottom: 20 },

  card:      { backgroundColor: C.card, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  cardLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  cardBody:  { fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#4A4039', lineHeight: 25 },
  safetyCard: { backgroundColor: '#FFF8E8', borderColor: '#E9D7A8', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 18, gap: 6 },
  safetyTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#6F5721', marginBottom: 2 },
  safetyText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#594A2C', lineHeight: 18 },

  sectionLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  insightList: { gap: 8, marginBottom: 18 },
  insightRow:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  insightNum:  { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  insightNumText:{ fontFamily: 'DMSans_500Medium', fontSize: 10, fontWeight: '700' },
  insightText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#4A4039', lineHeight: 22, flex: 1 },

  productsLink:     { borderWidth: 1.5, borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginBottom: 20 },
  productsLinkText: { fontFamily: 'DMSans_500Medium', fontSize: 14 },

  affirmation: { borderWidth: 1.5, borderRadius: 16, padding: 18, marginBottom: 24, alignItems: 'center' },
  affirmLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, marginBottom: 8 },
  affirmText:  { fontFamily: 'CormorantGaramond_400Regular', fontSize: 15, lineHeight: 25, fontStyle: 'italic', textAlign: 'center' },

  cta:      { borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 14 },
  ctaText:  { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF', letterSpacing: 0.4 },
  ctaHint:  { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', fontStyle: 'italic' },
  // Outlined (secondary) button, same shape as the "See my products" link above.
  bookBtn:     { borderWidth: 1.5, borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  bookBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14 },
});
