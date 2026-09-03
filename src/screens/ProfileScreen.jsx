import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, Linking,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, fetchProductRecs } from '../constants';
import { useApp } from '../context/AppContext';
import { pollScan } from '../lib/skinScan';

const CONCERN_LABELS = {
  acne: 'Acne', pore: 'Pores', texture: 'Texture', redness: 'Redness',
  oiliness: 'Oiliness', moisture: 'Moisture', radiance: 'Radiance', wrinkle: 'Fine lines & wrinkles',
};
const SEVERITY_META = [
  { label: 'Strong',     color: '#7A9E6E' },
  { label: 'Good',       color: '#8FAE7A' },
  { label: 'Watch',      color: '#B8924A' },
  { label: 'Needs work', color: '#C4784B' },
  { label: 'Priority',   color: '#C44B4B' },
];

export default function ProfileScreen({ navigation }) {
  const { analysis, setAnalysis, answers, user, srProducts, shelfAnalysis, analysisSaveFailed, setAnalysisSaveFailed } = useApp();
  const era = analysis?.era;
  const audit         = analysis?.productAudit || {};

  const replaceItems = audit.replace || [];
  const addItems     = audit.add     || [];

  const auditTabs = [
    { key:'remove',  label:'🚫 Remove',  color:'#C44B4B', items: audit.remove  || [] },
    { key:'replace', label:'🔄 Replace', color:'#B8924A', items: replaceItems },
    { key:'add',     label:'➕ Add',     color:'#7A9E6E', items: addItems },
    { key:'keep',    label:'✅ Keep',    color:'#6A98B0', items: audit.keep    || [] },
  ].filter(t => t.items.length > 0);

  const [auditTab,    setAuditTab]    = useState(auditTabs[0]?.key || 'add');
  const [srTab,       setSrTab]       = useState('am');
  const [productRecs, setProductRecs] = useState(null);
  const [country,     setCountry]     = useState(null);
  const [loadingRecs, setLoadingRecs] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (!addItems.length && !replaceItems.length) return;
    setLoadingRecs(true);
    (async () => {
      try {
        const c    = answers?.country || 'United States';
        setCountry(c);
        const recs = await fetchProductRecs(audit, c, era?.name || '');
        setProductRecs(recs);
      } catch (e) { console.warn('Product recs:', e.message); }
      setLoadingRecs(false);
    })();
  }, [user]);

  useEffect(() => {
    const scanId = analysis?.skinScanId || answers?.skinScanId;
    const scanToken = answers?.skinScanToken;
    if (!scanId || analysis?.skinScan) return;
    let cancelled = false;
    let attempts = 0;

    async function refreshScan() {
      const result = await pollScan(scanId, scanToken);
      if (cancelled) return;
      if (result?.status === 'complete' && result.skinScan) {
        setAnalysis(current => current ? { ...current, skinScanId: scanId, skinScan: result.skinScan } : current);
        return;
      }
      if (result?.status === 'failed' || attempts >= 30) return;
      attempts += 1;
      setTimeout(refreshScan, 2000);
    }
    refreshScan();
    return () => { cancelled = true; };
  }, [analysis?.skinScanId, analysis?.skinScan, answers?.skinScanId, answers?.skinScanToken]);

  if (!analysis) return null;

  const currentTab = auditTabs.find(t => t.key === auditTab);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: era.bg }]}>
      <ScrollView contentContainerStyle={s.content}>

        {analysisSaveFailed && (
          <View style={s.saveWarnBanner}>
            <Text style={s.saveWarnText}>
              We couldn't save this assessment — it may not appear next time you open the app.
            </Text>
            <Pressable onPress={() => setAnalysisSaveFailed(false)} hitSlop={8}>
              <Text style={s.saveWarnDismiss}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Era hero */}
        <View style={s.eraHero}>
          <Text style={s.eraEmoji}>{era.emoji}</Text>
          <Text style={s.eraEyebrow}>Your skin is in</Text>
          <Text style={[s.eraName, { color: era.color }]}>{era.name}</Text>
          <Text style={s.eraTagline}>"{era.tagline}"</Text>
        </View>
        <View style={[s.divider, { backgroundColor: era.color + '30' }]} />

        {/* Analysis */}
        <View style={s.card}>
          <Text style={s.cardLabel}>🔬 Skin Analysis</Text>
          <Text style={s.cardBody}>{analysis.skinAnalysis}</Text>
        </View>

        {/* Key Insights */}
        <Text style={s.sectionLabel}>💡 Key Insights</Text>
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

        {/* AI Skin Scan — only present when the PerfectCorp scan landed before this reveal.
            Purely supplementary: it never changes the Era above, per the quiz-anchored design. */}
        {analysis.skinScan?.fusion && (
          <View style={s.card}>
            <Text style={s.cardLabel}>📷 AI Skin Scan</Text>

            {analysis.skinScan.fusion.skinType?.resolved && (
              <Text style={s.scanSkinType}>
                Skin type: {analysis.skinScan.fusion.skinType.observed || analysis.skinScan.fusion.skinType.reported}
                {analysis.skinScan.fusion.skinType.tZone ? ` · T-zone ${analysis.skinScan.fusion.skinType.tZone}` : ''}
              </Text>
            )}

            <View style={s.scanConcernList}>
              {analysis.skinScan.fusion.concerns.slice(0, 5).map(c => {
                const meta = SEVERITY_META[c.severity] || SEVERITY_META[0];
                return (
                  <View key={c.key} style={s.scanConcernRow}>
                    <View style={[s.scanDot, { backgroundColor: meta.color }]} />
                    <Text style={s.scanConcernLabel}>{CONCERN_LABELS[c.key] || c.key}</Text>
                    <Text style={[s.scanConcernSeverity, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                );
              })}
            </View>

            {analysis.skinScan.fusion.discoveries?.length > 0 && (
              <View style={s.scanDiscoveries}>
                {analysis.skinScan.fusion.discoveries.map(d => (
                  <Text key={d.key} style={s.scanDiscoveryText}>
                    ✨ Your photo also shows some {(CONCERN_LABELS[d.key] || d.key).toLowerCase()} — worth
                    keeping an eye on, though it's not driving your routine right now.
                  </Text>
                ))}
              </View>
            )}

            <Text style={s.scanDisclaimer}>
              This is a cosmetic skin assessment, not a medical evaluation. If something on your skin
              concerns you, please see a dermatologist.
            </Text>
          </View>
        )}

        {/* Product Audit */}
        {auditTabs.length > 0 && (
          <View style={s.auditSection}>
            <View style={s.auditHeader}>
              <Text style={s.sectionLabel}>🧴 Product Audit</Text>
              {country && (
                <View style={[s.countryBadge, { backgroundColor: era.color + '15' }]}>
                  <Text style={[s.countryText, { color: era.color }]}>📍 {country}</Text>
                </View>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabRow}>
              {auditTabs.map(t => (
                <Pressable
                  key={t.key}
                  onPress={() => setAuditTab(t.key)}
                  style={[s.tabBtn, auditTab === t.key && { borderColor: t.color, backgroundColor: t.color + '18' }]}
                >
                  <Text style={[s.tabText, auditTab === t.key && { color: t.color, fontFamily: 'DMSans_500Medium' }]}>
                    {t.label} ({t.items.length})
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
                              <Text style={s.replaceArrow}>→</Text>
                              <Text style={s.replaceTo}>{item.to}</Text>
                            </View>
                            <Text style={s.auditReason}>{item.reason}</Text>
                          </>
                        ) : currentTab.key === 'add' ? (
                          <>
                            <View style={s.addHeader}>
                              <Text style={s.auditProduct}>{item.product}</Text>
                              {item.priority && (
                                <View style={[s.priorityBadge, { backgroundColor: item.priority === 'essential' ? '#C44B4B18' : '#B8924A15' }]}>
                                  <Text style={[s.priorityText, { color: item.priority === 'essential' ? '#C44B4B' : '#B8924A' }]}>{item.priority}</Text>
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
            <Text style={s.sectionLabel}>🧴 Your SR Ritual</Text>
            {srProducts.bundle_note && (
              <Text style={s.srBundleNote}>{srProducts.bundle_note}</Text>
            )}

            {/* Hero product */}
            {srProducts.era_hero_product?.sr_product_name && (
              <View style={[s.srHeroCard, { borderColor: era.color + '40', backgroundColor: era.color + '0C' }]}>
                <View style={s.srHeroBadge}>
                  <Text style={[s.srHeroBadgeText, { color: era.color }]}>ERA HERO</Text>
                </View>
                <Text style={[s.srHeroName, { color: era.color }]}>{srProducts.era_hero_product.sr_product_name}</Text>
                <Text style={s.srHeroReason}>{srProducts.era_hero_product.hero_reason}</Text>
              </View>
            )}

            {/* AM / PM tabs */}
            <View style={s.srTabRow}>
              {['am', 'pm'].map(t => (
                <Pressable
                  key={t}
                  onPress={() => setSrTab(t)}
                  style={[s.srTabBtn, srTab === t && { borderColor: era.color, backgroundColor: era.color + '18' }]}
                >
                  <Text style={[s.srTabText, srTab === t && { color: era.color, fontFamily: 'DMSans_500Medium' }]}>
                    {t === 'am' ? '☀️ Morning' : '🌙 Evening'}
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
                    <Text style={s.srNoMatch}>{step.no_match_note || 'Source externally for this step.'}</Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Current Shelf (from product photos) */}
        {shelfAnalysis?.identified_products?.length > 0 && (
          <View style={s.srSection}>
            <Text style={s.sectionLabel}>📸 Your Current Shelf</Text>
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
                        <Text style={[s.shelfStatusText, { color: statusColor }]}>{p.status}</Text>
                      </View>
                    </View>
                    {p.status_reason ? <Text style={s.srMatchReason}>{p.status_reason}</Text> : null}
                    {p.use_instruction ? <Text style={s.srUseInstruction}>{p.use_instruction}</Text> : null}
                    {p.sr_substitute_name ? (
                      <Text style={[s.srProductName, { color: era.color }]}>→ Swap with {p.sr_substitute_name}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {shelfAnalysis.transition_plan?.first_sr_purchase && (
              <Text style={s.srMatchReason}>
                Start here: <Text style={{ color: era.color }}>{shelfAnalysis.transition_plan.first_sr_purchase}</Text>
              </Text>
            )}
          </View>
        )}

        {/* Affirmation */}
        <View style={[s.affirmation, { borderColor: era.color + '50' }]}>
          <Text style={s.affirmLabel}>YOUR AFFIRMATION</Text>
          <Text style={[s.affirmText, { color: era.color }]}>"{analysis.affirmation || era.affirmation}"</Text>
        </View>

        <Pressable
          style={[s.cta, { backgroundColor: era.color }]}
          onPress={() => navigation.navigate(user ? 'Home' : 'SignUp')}
        >
          <Text style={s.ctaText}>See My Routine →</Text>
        </Pressable>
        <Text style={s.ctaHint}>Your era updates as your skin evolves.</Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProductCard({ rec, color }) {
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
        <Text style={s.shopBtnText}>Shop →</Text>
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

  scanSkinType:    { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, marginBottom: 12 },
  scanConcernList: { gap: 9, marginBottom: 8 },
  scanConcernRow:  { flexDirection: 'row', alignItems: 'center', gap: 9 },
  scanDot:         { width: 8, height: 8, borderRadius: 4 },
  scanConcernLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#4A4039', flex: 1 },
  scanConcernSeverity:{ fontFamily: 'DMSans_500Medium', fontSize: 11 },
  scanDiscoveries: { marginTop: 12, gap: 6 },
  scanDiscoveryText:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 19, fontStyle: 'italic' },
  scanDisclaimer:  { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, lineHeight: 16, marginTop: 14 },

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
  tabBtn:      { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 18, borderWidth: 1.5, borderColor: C.border, marginRight: 6 },
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
  priorityBadge:{ borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8, marginLeft: 8 },
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
  shelfStatusPill:  { marginLeft: 'auto', borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8 },
  shelfStatusText:  { fontFamily: 'DMSans_500Medium', fontSize: 10, textTransform: 'capitalize' },

  affirmation: { borderWidth: 1.5, borderRadius: 16, padding: 18, marginBottom: 24, alignItems: 'center' },
  affirmLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, marginBottom: 8 },
  affirmText:  { fontFamily: 'CormorantGaramond_400Regular', fontSize: 15, lineHeight: 25, fontStyle: 'italic', textAlign: 'center' },

  cta:      { borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 14 },
  ctaText:  { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF', letterSpacing: 0.4 },
  ctaHint:  { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', fontStyle: 'italic' },
});
