import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, Linking,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation, Trans } from 'react-i18next';
import { C, fetchProductRecs } from '../constants';
import { useApp } from '../context/AppContext';
import { pollScan } from '../lib/skinScan';
import FallbackBanner from '../components/FallbackBanner';
import ScoreSection from '../components/ScoreSection';
import { MenuButton } from '../components/SideMenu';
import { eraText, analysisAffirmation } from '../lib/eraText';

// U+2068 / U+2069 (first-strong isolate) around a value interpolated into a sentence, so a Latin
// value cannot reorder the surrounding Hebrew. Invisible in English.
const isolate = v => '\u2068' + v + '\u2069';

// Label for a raw server value (audit priority, shelf status). `prefix` is a key path such as
// 'profile:audit.priority'. Unknown values (or anything that is not a plain word) show as received.
function enumLabel(t, prefix, value) {
  return typeof value === 'string' && /^[a-z_]+$/i.test(value)
    ? t(`${prefix}.${value}`, { defaultValue: value })
    : value;
}

export default function ProfileScreen({ navigation, route }) {
  // t() resolves text at render time, so it follows the current language.
  const { t, i18n } = useTranslation();
  const {
    analysis, setAnalysis, answers, user, analysisSaveFailed, setAnalysisSaveFailed,
    productRecsCache, setProductRecsCache,
  } = useApp();
  // Opened from Home (the "My skin profile" header button or the "View my full analysis"
  // card), not from the quiz reveal.
  const openedFromHome = Boolean(route?.params?.fromHome);
  const era = analysis?.era;
  // Product routine + shelf audit travel on the analysis itself, so a saved analysis
  // loaded after a reload/login shows them too (null for fallbacks and older records).
  // Right after the quiz they come straight from the analysis service on the same object;
  // after a resume refresh they are the server copy, admin edits included.
  const srProducts    = analysis?.srProducts;
  const shelfAnalysis = analysis?.shelfAnalysis;
  const audit         = analysis?.productAudit || {};

  const replaceItems = audit.replace || [];
  const addItems     = audit.add     || [];
  // The items that get product picks, as a string: a stable dependency for the effect below.
  const auditPickKey = JSON.stringify([addItems, replaceItems]);

  const auditTabs = [
    { key:'remove',  color:'#C44B4B', items: audit.remove  || [] },
    { key:'replace', color:'#B8924A', items: replaceItems },
    { key:'add',     color:'#7A9E6E', items: addItems },
    { key:'keep',    color:'#6A98B0', items: audit.keep    || [] },
  ].filter(tab => tab.items.length > 0);

  const [auditTab,    setAuditTab]    = useState(auditTabs[0]?.key || 'add');
  const [srTab,       setSrTab]       = useState('am');
  const [productRecs, setProductRecs] = useState(null);
  const [country,     setCountry]     = useState(null);
  const [loadingRecs, setLoadingRecs] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Picks edited by the clinic in the admin dashboard win: show exactly those and do
    // not ask Claude. Without them, reuse this session's picks for the same audit (cache
    // below), else ask Claude. Nothing is saved server-side, so a reload asks again.
    if (analysis?.productRecs) {
      setProductRecs(analysis.productRecs);
      setLoadingRecs(false);
      return;
    }
    if (!addItems.length && !replaceItems.length) return;
    // Quiz answers are only in memory in the quiz session; a saved analysis (reopened
    // after a reload) carries its own copy, so use that before the US default.
    const c   = answers?.country || analysis?.quizAnswers?.country || 'United States';
    const key = JSON.stringify([audit, c, era?.name || '']);
    // Session cache: reopening Profile for the same audit reuses the earlier result
    // instead of calling the paid, rate-limited recommendations endpoint again.
    if (productRecsCache?.key === key) {
      setCountry(productRecsCache.country);
      setProductRecs(productRecsCache.recs);
      // An earlier run of this effect may have been cancelled mid-request (its spinner
      // is then never cleared by that run), so clear it here, like the admin-picks branch.
      setLoadingRecs(false);
      return;
    }
    setLoadingRecs(true);
    // Set by the cleanup below when this effect re-runs (e.g. admin picks arrived) or the
    // screen closes, so a slow Claude answer can never overwrite newer picks.
    let cancelled = false;
    (async () => {
      try {
        setCountry(c);
        const recs = await fetchProductRecs(audit, c, era?.name || '');
        // Cached even if this run was cancelled: the picks are still correct for `key`, so
        // reopening Profile for the same audit reuses them instead of paying again.
        setProductRecsCache({ key, recs, country: c });
        if (!cancelled) setProductRecs(recs);
      } catch (e) { console.warn('Product recs:', e.message); }
      if (!cancelled) setLoadingRecs(false);
    })();
    return () => { cancelled = true; };
    // Re-run when a resume refresh brings in admin-edited picks (productRecs) or a changed
    // add/replace list (new items need picks). The list is compared as a string, so an
    // equal list in a new object does not trigger another Claude call.
  }, [user, analysis?.productRecs, auditPickKey]);

  // The scan is "settled" once its result is in AND Railway's score-section copy is no longer
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
        // Always take the fresh copy: signals now, and the reading once Railway answers.
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

  if (!analysis) return null;

  const currentTab = auditTabs.find(tab => tab.key === auditTab);

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
            (PerfectCorp scan + Railway copy). Replaces the old "AI Skin Scan" card. */}
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

        {/* Product Audit */}
        {auditTabs.length > 0 && (
          <View style={s.auditSection}>
            <View style={s.auditHeader}>
              <Text style={s.sectionLabel}>{t('profile:audit.title')}</Text>
              {country && (
                <View style={[s.countryBadge, { backgroundColor: era.color + '15' }]}>
                  <Text style={[s.countryText, { color: era.color }]}>📍 {country}</Text>
                </View>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabRow}>
              {auditTabs.map(tab => (
                <Pressable
                  key={tab.key}
                  onPress={() => setAuditTab(tab.key)}
                  style={[s.tabBtn, auditTab === tab.key && { borderColor: tab.color, backgroundColor: tab.color + '18' }]}
                >
                  <Text style={[s.tabText, auditTab === tab.key && { color: tab.color, fontFamily: 'DMSans_500Medium' }]}>
                    {/* e.g. "Replace (2)": one translated string, drawn as separate pieces
                        ("Replace", " (", "2", ")") exactly like the old hard-coded JSX did, so the
                        English pixels stay identical. Hebrew keeps its own word order. */}
                    {t(`profile:audit.${tab.key}`, { count: tab.items.length }).split(/( [(]|\d+)/).filter(Boolean)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {currentTab && (
              <View style={s.auditItems}>
                {currentTab.items.map((item, i) => {
                  const rec = (currentTab.key === 'replace' || currentTab.key === 'add')
                    ? (productRecs?.[currentTab.key] || []).find(r => r.index === i)?.rec
                    : null;
                  return (
                    <View key={i}>
                      <View style={[s.auditCard, { borderColor: currentTab.color + '22' }]}>
                        {currentTab.key === 'replace' ? (
                          <>
                            <View style={s.replaceRow}>
                              <Text style={s.replaceFrom}>{item.from}</Text>
                              {item.to ? <Text style={s.replaceArrow}>{t('common:arrowNext')}</Text> : null}
                              {item.to ? <Text style={s.replaceTo}>{item.to}</Text> : null}
                            </View>
                            <Text style={s.auditReason}>{item.reason}</Text>
                          </>
                        ) : currentTab.key === 'add' ? (
                          <>
                            <View style={s.addHeader}>
                              <Text style={s.auditProduct}>{item.product}</Text>
                              {item.priority && (
                                <View style={[s.priorityBadge, { backgroundColor: item.priority === 'essential' ? '#C44B4B18' : '#B8924A15' }]}>
                                  <Text style={[s.priorityText, { color: item.priority === 'essential' ? '#C44B4B' : '#B8924A' }]}>{enumLabel(t, 'profile:audit.priority', item.priority)}</Text>
                                </View>
                              )}
                            </View>
                            <Text style={s.auditReason}>{item.reason}</Text>
                          </>
                        ) : (
                          <>
                            <Text style={s.auditProduct}>{item.product || item.from}</Text>
                            <Text style={s.auditReason}>{item.reason}</Text>
                          </>
                        )}
                      </View>
                      {(currentTab.key === 'replace' || currentTab.key === 'add') && (
                        rec
                          ? <ProductCard rec={rec} color={currentTab.color} />
                          : loadingRecs && <ProductSkeleton />
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* SR Ritual */}
        {srProducts && (
          <View style={s.srSection}>
            <Text style={s.sectionLabel}>{t('profile:sr.title')}</Text>
            {srProducts.bundle_note && (
              <Text style={s.srBundleNote}>{srProducts.bundle_note}</Text>
            )}

            {/* Hero product */}
            {srProducts.era_hero_product?.sr_product_name && (
              <View style={[s.srHeroCard, { borderColor: era.color + '40', backgroundColor: era.color + '0C' }]}>
                <View style={s.srHeroBadge}>
                  <Text style={[s.srHeroBadgeText, { color: era.color }]}>{t('profile:sr.heroBadge')}</Text>
                </View>
                <Text style={[s.srHeroName, { color: era.color }]}>{srProducts.era_hero_product.sr_product_name}</Text>
                <Text style={s.srHeroReason}>{srProducts.era_hero_product.hero_reason}</Text>
              </View>
            )}

            {/* AM / PM tabs */}
            <View style={s.srTabRow}>
              {['am', 'pm'].map(tabKey => (
                <Pressable
                  key={tabKey}
                  onPress={() => setSrTab(tabKey)}
                  style={[s.srTabBtn, srTab === tabKey && { borderColor: era.color, backgroundColor: era.color + '18' }]}
                >
                  <Text style={[s.srTabText, srTab === tabKey && { color: era.color, fontFamily: 'DMSans_500Medium' }]}>
                    {tabKey === 'am' ? t('profile:sr.morning') : t('profile:sr.evening')}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={s.srSteps}>
              {(srProducts[srTab] || []).map((step, i) => (
                <View key={i} style={[s.srStepCard, { borderColor: era.color + '20' }]}>
                  <View style={s.srStepHeader}>
                    <View style={[s.srStepNum, { backgroundColor: era.color + '20' }]}>
                      <Text style={[s.srStepNumText, { color: era.color }]}>{step.step}</Text>
                    </View>
                    <Text style={s.srStepCategory}>{step.routine_category}</Text>
                  </View>
                  {step.sr_product_id ? (
                    <>
                      <Text style={[s.srProductName, { color: era.color }]}>{step.sr_product_name}</Text>
                      {step.key_actives_matched?.length > 0 && (
                        <View style={s.srActives}>
                          {step.key_actives_matched.slice(0, 3).map((a, j) => (
                            <View key={j} style={[s.srActivePill, { backgroundColor: era.color + '15' }]}>
                              <Text style={[s.srActivePillText, { color: era.color }]}>{a.replace(/_/g, ' ')}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      <Text style={s.srUseInstruction}>{step.use_instruction}</Text>
                      <Text style={s.srMatchReason}>{step.match_reason}</Text>
                    </>
                  ) : (
                    <Text style={s.srNoMatch}>{step.no_match_note || t('profile:sr.noMatch')}</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Current Shelf (from product photos) */}
        {shelfAnalysis?.identified_products?.length > 0 && (
          <View style={s.srSection}>
            <Text style={s.sectionLabel}>{t('profile:shelf.title')}</Text>
            {shelfAnalysis.shelf_summary?.overall_note && (
              <Text style={s.srBundleNote}>{shelfAnalysis.shelf_summary.overall_note}</Text>
            )}
            <View style={s.srSteps}>
              {shelfAnalysis.identified_products.map((p, i) => {
                const statusColor = p.status === 'compatible' ? '#7A9E6E'
                  : p.status === 'conflicting' ? '#C44B4B'
                  : p.status === 'borderline' ? '#B8924A' : C.muted;
                return (
                  <View key={i} style={[s.srStepCard, { borderColor: statusColor + '30' }]}>
                    <View style={s.srStepHeader}>
                      <Text style={s.srStepCategory}>{[p.brand, p.product_name].filter(Boolean).join(' · ') || p.category}</Text>
                      <View style={[s.shelfStatusPill, { backgroundColor: statusColor + '18' }]}>
                        <Text style={[s.shelfStatusText, { color: statusColor }]}>{enumLabel(t, 'profile:shelf.status', p.status)}</Text>
                      </View>
                    </View>
                    {p.status_reason ? <Text style={s.srMatchReason}>{p.status_reason}</Text> : null}
                    {p.use_instruction ? <Text style={s.srUseInstruction}>{p.use_instruction}</Text> : null}
                    {p.sr_substitute_name ? (
                      <Text style={[s.srProductName, { color: era.color }]}>{t('profile:shelf.swap', { name: isolate(p.sr_substitute_name) })}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {shelfAnalysis.transition_plan?.first_sr_purchase && (
              <Text style={s.srMatchReason}>
                {/* The product name is styled, so <Trans> lets each language place it freely. */}
                <Trans
                  i18nKey="profile:shelf.startHere"
                  values={{ product: isolate(shelfAnalysis.transition_plan.first_sr_purchase) }}
                  components={{ product: <Text style={{ color: era.color }} /> }}
                />
              </Text>
            )}
          </View>
        )}

        {/* Affirmation */}
        <View style={[s.affirmation, { borderColor: era.color + '50' }]}>
          <Text style={s.affirmLabel}>{t('profile:affirmLabel')}</Text>
          {/* The affirmation is usually AI text (English), so it is isolated inside the quotes. */}
          <Text style={[s.affirmText, { color: era.color }]}>"{isolate(analysisAffirmation(analysis, i18n.language))}"</Text>
        </View>

        <Pressable
          style={[s.cta, { backgroundColor: era.color }]}
          // The routine (Home) always needs an account:
          //  - no user (took "Skip for now")          -> SignUp, which saves this analysis;
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

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProductCard({ rec, color }) {
  const { t } = useTranslation();
  return (
    <Pressable
      style={[s.productCard, { borderColor: color + '25' }]}
      onPress={() => rec.url && Linking.openURL(rec.url)}
    >
      <View style={s.productInfo}>
        <Text style={s.productBrand}>{rec.brand}</Text>
        <Text style={s.productName}>{rec.name}</Text>
        <View style={s.productMeta}>
          {rec.price    && <Text style={[s.productPrice, { color }]}>{rec.price}</Text>}
          {rec.retailer && <Text style={s.productRetailer}> · {rec.retailer}</Text>}
        </View>
      </View>
      <View style={[s.shopBtn, { backgroundColor: color }]}>
        <Text style={s.shopBtnText}>{t('profile:shop')}</Text>
      </View>
    </Pressable>
  );
}

function ProductSkeleton() {
  return (
    <View style={s.skeleton}>
      <View style={s.skeletonImg} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={[s.skeletonLine, { width: '40%', height: 8 }]} />
        <View style={[s.skeletonLine, { width: '75%', height: 11 }]} />
        <View style={[s.skeletonLine, { width: '50%', height: 8 }]} />
      </View>
    </View>
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

  sectionLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  insightList: { gap: 8, marginBottom: 18 },
  insightRow:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  insightNum:  { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  insightNumText:{ fontFamily: 'DMSans_500Medium', fontSize: 10, fontWeight: '700' },
  insightText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#4A4039', lineHeight: 22, flex: 1 },

  auditSection:{ marginBottom: 20 },
  auditHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  countryBadge:{ flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingVertical: 3, paddingHorizontal: 9 },
  countryText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  tabRow:      { marginBottom: 12 },
  tabBtn:      { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 18, borderWidth: 1.5, borderColor: C.border, marginEnd: 6 },
  tabText:     { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  auditItems:  { gap: 12 },
  auditCard:   { backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1 },
  replaceRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' },
  replaceFrom: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#C44B4B', textDecorationLine: 'line-through' },
  replaceArrow:{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  replaceTo:   { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#7A9E6E' },
  addHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  auditProduct:{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, flex: 1 },
  auditReason: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 19 },
  priorityBadge:{ borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8, marginStart: 8 },
  priorityText: { fontFamily: 'DMSans_500Medium', fontSize: 10 },

  productCard: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.card, borderRadius: 11, padding: 11, borderWidth: 1, marginTop: 8 },
  productInfo: { flex: 1 },
  productBrand:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, marginBottom: 1 },
  productName: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, lineHeight: 18 },
  productMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  productPrice:{ fontFamily: 'DMSans_500Medium', fontSize: 11, fontWeight: '600' },
  productRetailer:{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  shopBtn:     { borderRadius: 8, paddingVertical: 7, paddingHorizontal: 11 },
  shopBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#FFF', fontWeight: '600' },

  skeleton:    { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.bg, borderRadius: 12, padding: 11, borderWidth: 1, borderColor: C.border, marginTop: 8 },
  skeletonImg: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.border },
  skeletonLine:{ backgroundColor: C.border, borderRadius: 4 },

  srSection:        { marginBottom: 20 },
  srBundleNote:     { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 19, marginBottom: 14, fontStyle: 'italic' },
  srHeroCard:       { borderWidth: 1.5, borderRadius: 14, padding: 16, marginBottom: 14 },
  srHeroBadge:      { alignSelf: 'flex-start', borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8, marginBottom: 8 },
  srHeroBadgeText:  { fontFamily: 'DMSans_500Medium', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' },
  srHeroName:       { fontFamily: 'CormorantGaramond_500Medium', fontSize: 18, marginBottom: 6 },
  srHeroReason:     { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#4A4039', lineHeight: 20 },
  srTabRow:         { flexDirection: 'row', gap: 8, marginBottom: 12 },
  srTabBtn:         { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderColor: C.border },
  srTabText:        { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  srSteps:          { gap: 10 },
  srStepCard:       { backgroundColor: C.card, borderRadius: 13, padding: 13, borderWidth: 1 },
  srStepHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  srStepNum:        { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  srStepNumText:    { fontFamily: 'DMSans_500Medium', fontSize: 11, fontWeight: '700' },
  srStepCategory:   { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 },
  srProductName:    { fontFamily: 'DMSans_500Medium', fontSize: 14, marginBottom: 7 },
  srActives:        { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 8 },
  srActivePill:     { borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8 },
  srActivePillText: { fontFamily: 'DMSans_400Regular', fontSize: 10 },
  srUseInstruction: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#4A4039', lineHeight: 20, marginBottom: 5 },
  srMatchReason:    { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, lineHeight: 18, fontStyle: 'italic' },
  srNoMatch:        { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic' },
  shelfStatusPill:  { marginStart: 'auto', borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8 },
  shelfStatusText:  { fontFamily: 'DMSans_500Medium', fontSize: 10, textTransform: 'capitalize' },

  affirmation: { borderWidth: 1.5, borderRadius: 16, padding: 18, marginBottom: 24, alignItems: 'center' },
  affirmLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, marginBottom: 8 },
  affirmText:  { fontFamily: 'CormorantGaramond_400Regular', fontSize: 15, lineHeight: 25, fontStyle: 'italic', textAlign: 'center' },

  cta:      { borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 14 },
  ctaText:  { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF', letterSpacing: 0.4 },
  ctaHint:  { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', fontStyle: 'italic' },
});
