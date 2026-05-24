import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, Linking,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, fetchProductRecs } from '../constants';
import { useApp } from '../context/AppContext';

async function detectCountry() {
  try {
    const r = await fetch('https://ipapi.co/json/');
    const d = await r.json();
    return d.country_name || 'United States';
  } catch {
    return 'United States';
  }
}

export default function ProfileScreen({ navigation }) {
  const { analysis } = useApp();
  const era           = analysis?.era;
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
  const [productRecs, setProductRecs] = useState(null);
  const [country,     setCountry]     = useState(null);
  const [loadingRecs, setLoadingRecs] = useState(false);

  useEffect(() => {
    if (!addItems.length && !replaceItems.length) return;
    setLoadingRecs(true);
    (async () => {
      try {
        const c    = await detectCountry();
        setCountry(c);
        const recs = await fetchProductRecs(audit, c, era?.name || '');
        setProductRecs(recs);
      } catch (e) { console.warn('Product recs:', e.message); }
      setLoadingRecs(false);
    })();
  }, []);

  if (!analysis) return null;

  const currentTab = auditTabs.find(t => t.key === auditTab);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: era.bg }]}>
      <ScrollView contentContainerStyle={s.content}>

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

        {/* Affirmation */}
        <View style={[s.affirmation, { borderColor: era.color + '50' }]}>
          <Text style={s.affirmLabel}>YOUR AFFIRMATION</Text>
          <Text style={[s.affirmText, { color: era.color }]}>"{analysis.affirmation || era.affirmation}"</Text>
        </View>

        <Pressable
          style={[s.cta, { backgroundColor: era.color }]}
          onPress={() => navigation.navigate('SignUp')}
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

  affirmation: { borderWidth: 1.5, borderRadius: 16, padding: 18, marginBottom: 24, alignItems: 'center' },
  affirmLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, marginBottom: 8 },
  affirmText:  { fontFamily: 'CormorantGaramond_400Regular', fontSize: 15, lineHeight: 25, fontStyle: 'italic', textAlign: 'center' },

  cta:      { borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 14 },
  ctaText:  { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF', letterSpacing: 0.4 },
  ctaHint:  { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', fontStyle: 'italic' },
});
