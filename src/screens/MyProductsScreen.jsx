import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, Linking, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation, Trans } from 'react-i18next';
import { C, fetchProductRecs } from '../constants';
import { useApp } from '../context/AppContext';
import { MenuButton } from '../components/SideMenu';
import CatalogueProductCard from '../components/CatalogueProductCard';
import { useCatalogueProducts } from '../lib/useCatalogueProducts';
import { buildProductSafetyContext } from '../lib/analyzeWithRailway';

// A catalogue product id is a 24-character hex string. Old analyses hold ids like "sr-clean",
// which have no catalogue entry, so they are shown as text only.
const HEX_ID = /^[a-f0-9]{24}$/;
const hexId = v => (typeof v === 'string' && HEX_ID.test(v) ? v : null);

// U+2068 / U+2069 (first-strong isolate) around a value interpolated into a sentence, so a Latin
// value cannot reorder the surrounding Hebrew. Invisible in English. (Copied from ProfileScreen.)
const isolate = v => '⁨' + v + '⁩';

// Label for a raw server value (audit priority, shelf status). Unknown values show as received.
function enumLabel(t, prefix, value) {
  return typeof value === 'string' && /^[a-z_]+$/i.test(value)
    ? t(`${prefix}.${value}`, { defaultValue: value })
    : value;
}

// "My products": every product the analysis recommends, in one place.
// Sections (top to bottom): hero, SR ritual (AM/PM), replace suggestions, current shelf,
// other options (AI market picks), product audit. Opened from the side menu, Home and Profile.
// Going back is the edge swipe handled in App.jsx (same as Profile / Messages / Settings).
export default function MyProductsScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const { analysis, answers, user, productRecsCache, setProductRecsCache } = useApp();
  const era = analysis?.era;
  const color = era?.color || C.accent;

  // Product data travels on the saved analysis (null for fallbacks and older records).
  const srProducts    = analysis?.srProducts;
  const shelfAnalysis = analysis?.shelfAnalysis;
  const audit         = analysis?.productAudit || {};
  const replaceItems  = audit.replace || [];
  const addItems      = audit.add     || [];
  // The items that get market picks, as a string: a stable dependency for the effect below.
  const auditPickKey = JSON.stringify([addItems, replaceItems]);

  // The audit tabs. Replace items have their own section, so there is no replace tab here.
  const auditTabs = [
    { key: 'remove', color: '#C44B4B', items: audit.remove || [] },
    { key: 'add',    color: '#7A9E6E', items: addItems },
    { key: 'keep',   color: '#6A98B0', items: audit.keep   || [] },
  ].filter(tab => tab.items.length > 0);

  const [auditTab, setAuditTab] = useState(auditTabs[0]?.key || 'add');
  const [srTab, setSrTab] = useState('am');
  const [productRecs, setProductRecs] = useState(null);
  const [country, setCountry] = useState(null);

  // Catalogue data (photo, price, shop link) for every product id on the screen, loaded ONCE.
  // With no ids (empty state) the hook makes no request at all.
  const heroId = hexId(srProducts?.era_hero_product?.sr_product_id);
  const catalogueIds = [
    heroId,
    ...['am', 'pm'].flatMap(tab => (srProducts?.[tab] || []).map(step => hexId(step.sr_product_id))),
    ...replaceItems.map(item => hexId(item.to_product_id)),
  ].filter(Boolean);
  const { products } = useCatalogueProducts(catalogueIds);

  // Market picks ("Other options"). MOVED unchanged from ProfileScreen.
  useEffect(() => {
    if (!user) return;
    // Picks edited by the clinic in the admin dashboard win: show exactly those and do
    // not request market picks. Without them, reuse this session's picks for the same audit (cache
    // below), else ask Claude. Nothing is saved server-side, so a reload asks again.
    if (analysis?.productRecs) {
      setProductRecs(analysis.productRecs);
      return;
    }
    if (!addItems.length && !replaceItems.length) return;
    // Quiz answers are only in memory in the quiz session; a saved analysis (reopened
    // after a reload) carries its own copy, so use that before the US default.
    const recAnswers = analysis?.quizAnswers || answers || {};
    const c   = recAnswers.country || 'United States';
    const safetyContext = buildProductSafetyContext(recAnswers);
    const language = i18n.language.startsWith('he') ? 'he' : 'en';
    const key = JSON.stringify([audit, c, era?.name || '', language, safetyContext]);
    // Session cache: reopening this screen for the same audit reuses the earlier result
    // instead of calling the paid, rate-limited recommendations endpoint again.
    if (productRecsCache?.key === key) {
      setCountry(productRecsCache.country);
      setProductRecs(productRecsCache.recs);
      return;
    }
    // Set by the cleanup below when this effect re-runs or the screen closes, so a slow
    // answer can never overwrite newer picks.
    let cancelled = false;
    (async () => {
      try {
        setCountry(c);
        const recs = await fetchProductRecs(audit, c, era?.name || '', { language, safetyContext });
        // Cached even if this run was cancelled: the picks are still correct for `key`.
        setProductRecsCache({ key, recs, country: c });
        if (!cancelled) setProductRecs(recs);
      } catch (e) { console.warn('Product recs:', e.message); }
    })();
    return () => { cancelled = true; };
    // Re-run when admin-edited picks arrive (productRecs) or the add/replace list changes.
  }, [user, analysis?.productRecs, auditPickKey, answers, analysis?.quizAnswers, i18n.language]);

  if (!analysis) return null;

  // Every pick (one per replace / add item that got one), flattened for the "Other options" list.
  const picks = [...(productRecs?.replace || []), ...(productRecs?.add || [])].filter(p => p?.rec);
  const currentTab = auditTabs.find(tab => tab.key === auditTab);
  const hero = srProducts?.era_hero_product;
  const showEmpty = !srProducts && replaceItems.length === 0;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: era?.bg || C.bg }]}>
      <ScrollView contentContainerStyle={s.content}>

        {/* Header row: menu button only. Going back is the edge swipe (App.jsx / SwipeBack). */}
        <View style={s.menuRow}>
          <MenuButton onPress={navigation.openMenu} color={color} />
        </View>

        {/* Hero: screen title and, when the analysis has one, the era's hero product. */}
        <View testID="myproducts-hero" style={s.section}>
          <Text style={s.pageTitle}>{t('products:title')}</Text>
          <Text style={s.intro}>{t('products:intro')}</Text>
          {hero?.sr_product_name ? (
            <View style={[s.heroWrap, { borderColor: color + '40', backgroundColor: color + '0C' }]}>
              <View style={s.heroBadge}>
                <Text style={[s.heroBadgeText, { color }]}>{t('profile:sr.heroBadge')}</Text>
              </View>
              {heroId ? (
                <CatalogueProductCard id={heroId} product={products[heroId]} fallbackName={hero.sr_product_name} color={color} heroCopy>
                  <Text style={s.useText}>{hero.hero_reason}</Text>
                </CatalogueProductCard>
              ) : (
                <>
                  <Text style={[s.heroName, { color }]}>{hero.sr_product_name}</Text>
                  <Text style={s.useText}>{hero.hero_reason}</Text>
                </>
              )}
            </View>
          ) : null}
        </View>

        {/* Empty state: no SR products and nothing to swap. No catalogue request was made. */}
        {showEmpty && (
          <View testID="myproducts-empty" style={s.emptyCard}>
            <Text style={s.emptyTitle}>{t('products:empty.title')}</Text>
            <Text style={s.emptyBody}>{t('products:empty.body')}</Text>
          </View>
        )}

        {/* SR ritual with Morning / Evening tabs */}
        {srProducts && (
          <View testID="myproducts-ritual" style={s.section}>
            <Text style={s.sectionLabel}>{t('profile:sr.title')}</Text>
            {srProducts.bundle_note ? <Text style={s.note}>{srProducts.bundle_note}</Text> : null}
            <View style={s.tabRow}>
              {['am', 'pm'].map(tabKey => (
                <Pressable
                  key={tabKey}
                  onPress={() => setSrTab(tabKey)}
                  style={[s.tabBtn, srTab === tabKey && { borderColor: color, backgroundColor: color + '18' }]}
                >
                  <Text style={[s.tabText, srTab === tabKey && { color, fontFamily: 'DMSans_500Medium' }]}>
                    {tabKey === 'am' ? t('profile:sr.morning') : t('profile:sr.evening')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={s.list}>
              {(srProducts[srTab] || []).map((step, i) => (
                <View key={i}>
                  {step.sr_product_id ? <Text style={s.stepCategory}>{step.step}. {step.routine_category}</Text> : null}
                  {step.sr_product_id ? (
                    // Matched step: a catalogue card (text-only when the id has no catalogue data).
                    <CatalogueProductCard
                      id={hexId(step.sr_product_id) || `${srTab}-${i}`}
                      product={products[hexId(step.sr_product_id)]}
                      fallbackName={step.sr_product_name}
                      color={color}
                    >
                      {step.key_actives_matched?.length > 0 && (
                        <View style={s.actives}>
                          {step.key_actives_matched.slice(0, 3).map((a, j) => (
                            <View key={j} style={[s.activePill, { backgroundColor: color + '15' }]}>
                              <Text style={[s.activePillText, { color }]}>{a.replace(/_/g, ' ')}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      <Text style={s.useText}>{step.use_instruction}</Text>
                      <Text style={s.reasonText}>{step.match_reason}</Text>
                    </CatalogueProductCard>
                  ) : (
                    // Unmatched step: the analysis found no SR product, so show its note instead.
                    <View testID={`product-step-unmatched-${srTab}-${i}`} style={[s.textCard, { borderColor: color + '20' }]}>
                      <Text style={s.stepCategory}>{step.step}. {step.routine_category}</Text>
                      <Text style={s.noMatch}>{step.no_match_note || t('profile:sr.noMatch')}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Replace suggestions: "Instead of <from>", the reason and the recommended catalogue product. */}
        {replaceItems.length > 0 && (
          <View testID="myproducts-replace" style={s.section}>
            <Text style={s.sectionLabel}>{t('products:replace.title')}</Text>
            <View style={s.list}>
              {replaceItems.map((item, i) => {
                const toId = hexId(item.to_product_id);
                return (
                  <View key={i}>
                    <Text style={s.insteadText}>{t('products:replace.instead', { from: item.from })}</Text>
                    <Text style={s.reasonPlain}>{item.reason}</Text>
                    {toId ? (
                      <CatalogueProductCard id={toId} product={products[toId]} fallbackName={item.to} color={color} />
                    ) : item.to ? (
                      // No catalogue id (admin typed a name / old analysis): text card.
                      <View testID={`product-card-replace-${i}`} style={[s.textCard, { borderColor: color + '20' }]}>
                        <Text style={[s.textCardName, { color }]}>{item.to}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Current shelf (from product photos): text only, moved from Profile. */}
        {shelfAnalysis?.identified_products?.length > 0 && (
          <View testID="myproducts-shelf" style={s.section}>
            <Text style={s.sectionLabel}>{t('profile:shelf.title')}</Text>
            {shelfAnalysis.shelf_summary?.overall_note ? (
              <Text style={s.note}>{shelfAnalysis.shelf_summary.overall_note}</Text>
            ) : null}
            <View style={s.list}>
              {shelfAnalysis.identified_products.map((p, i) => {
                const statusColor = p.status === 'compatible' ? '#7A9E6E'
                  : p.status === 'conflicting' ? '#C44B4B'
                  : p.status === 'borderline' ? '#B8924A' : C.muted;
                return (
                  <View key={i} style={[s.textCard, { borderColor: statusColor + '30' }]}>
                    <View style={s.shelfHeader}>
                      <Text style={s.stepCategoryInline}>{[p.brand, p.product_name].filter(Boolean).join(' · ') || p.category}</Text>
                      <View style={[s.statusPill, { backgroundColor: statusColor + '18' }]}>
                        <Text style={[s.statusText, { color: statusColor }]}>{enumLabel(t, 'profile:shelf.status', p.status)}</Text>
                      </View>
                    </View>
                    {p.status_reason ? <Text style={s.reasonText}>{p.status_reason}</Text> : null}
                    {p.use_instruction ? <Text style={s.useText}>{p.use_instruction}</Text> : null}
                    {p.sr_substitute_name ? (
                      <Text style={[s.heroName, { color }]}>{t('profile:shelf.swap', { name: isolate(p.sr_substitute_name) })}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {shelfAnalysis.transition_plan?.first_sr_purchase ? (
              <Text style={s.reasonText}>
                {/* The product name is styled, so <Trans> lets each language place it freely. */}
                <Trans
                  i18nKey="profile:shelf.startHere"
                  values={{ product: isolate(shelfAnalysis.transition_plan.first_sr_purchase) }}
                  components={{ product: <Text style={{ color }} /> }}
                />
              </Text>
            ) : null}
          </View>
        )}

        {/* Other options: AI market picks from other brands. Hidden when there are none. */}
        {picks.length > 0 && (
          <View testID="myproducts-other-options" style={s.section}>
            <View style={s.headerRow}>
              <Text style={s.sectionLabel}>{t('products:otherOptions.title')}</Text>
              {country ? (
                <View style={[s.countryBadge, { backgroundColor: color + '15' }]}>
                  <Text style={[s.countryText, { color }]}>📍 {country}</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.note}>{t('products:otherOptions.hint')}</Text>
            <View style={s.list}>
              {picks.map((p, i) => <MarketPickCard key={i} rec={p.rec} color={color} />)}
            </View>
          </View>
        )}

        {/* Product audit: remove / add / keep tabs (replace items have their own section above). */}
        {auditTabs.length > 0 && (
          <View testID="myproducts-audit" style={s.section}>
            <Text style={s.sectionLabel}>{t('profile:audit.title')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.auditTabRow}>
              {auditTabs.map(tab => (
                <Pressable
                  key={tab.key}
                  onPress={() => setAuditTab(tab.key)}
                  style={[s.auditTabBtn, auditTab === tab.key && { borderColor: tab.color, backgroundColor: tab.color + '18' }]}
                >
                  <Text style={[s.auditTabText, auditTab === tab.key && { color: tab.color, fontFamily: 'DMSans_500Medium' }]}>
                    {/* e.g. "Remove (2)": split into pieces exactly like Profile did. */}
                    {t(`profile:audit.${tab.key}`, { count: tab.items.length }).split(/( [(]|\d+)/).filter(Boolean)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {currentTab && (
              <View style={s.list}>
                {currentTab.items.map((item, i) => (
                  <View key={i} style={[s.textCard, { borderColor: currentTab.color + '22' }]}>
                    {currentTab.key === 'add' ? (
                      <View style={s.addHeader}>
                        <Text style={s.auditProduct}>{item.product}</Text>
                        {item.priority ? (
                          <View style={[s.priorityBadge, { backgroundColor: item.priority === 'essential' ? '#C44B4B18' : '#B8924A15' }]}>
                            <Text style={[s.priorityText, { color: item.priority === 'essential' ? '#C44B4B' : '#B8924A' }]}>{enumLabel(t, 'profile:audit.priority', item.priority)}</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <Text style={s.auditProduct}>{item.product || item.from}</Text>
                    )}
                    <Text style={s.reasonPlain}>{item.reason}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// One AI market pick (another brand). MOVED unchanged from ProfileScreen: tapping opens the retailer link.
function MarketPickCard({ rec, color }) {
  const { t } = useTranslation();
  return (
    <Pressable
      style={[s.pickCard, { borderColor: color + '25' }]}
      onPress={() => rec.url && Linking.openURL(rec.url)}
    >
      <View style={s.pickInfo}>
        <Text style={s.pickBrand}>{rec.brand}</Text>
        <Text style={s.pickName}>{rec.name}</Text>
        <View style={s.pickMeta}>
          {rec.price    && <Text style={[s.pickPrice, { color }]}>{rec.price}</Text>}
          {rec.retailer && <Text style={s.pickRetailer}> · {rec.retailer}</Text>}
        </View>
      </View>
      <View style={[s.shopBtn, { backgroundColor: color }]}>
        <Text style={s.shopBtnText}>{t('profile:shop')}</Text>
      </View>
    </Pressable>
  );
}

// Logical props (marginStart / marginEnd) and row direction so the screen mirrors in Hebrew.
const s = StyleSheet.create({
  safe:     { flex: 1 },
  content:  { padding: 24, paddingTop: 28 },
  menuRow:  { flexDirection: 'row', marginBottom: 16 },
  section:  { marginBottom: 24 },
  pageTitle:{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, marginBottom: 6 },
  intro:    { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, lineHeight: 20, marginBottom: 16 },
  sectionLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  headerRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note:     { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 19, marginBottom: 14, fontStyle: 'italic' },
  list:     { gap: 12 },

  heroWrap:     { borderWidth: 1.5, borderRadius: 14, padding: 12 },
  heroBadge:    { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, marginBottom: 6 },
  heroBadgeText:{ fontFamily: 'DMSans_500Medium', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase' },
  heroName:     { fontFamily: 'DMSans_500Medium', fontSize: 14, marginBottom: 6 },

  emptyCard:  { backgroundColor: C.card, borderRadius: 14, padding: 18, marginBottom: 24, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  emptyTitle: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.text, marginBottom: 6, textAlign: 'center' },
  emptyBody:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, lineHeight: 20, textAlign: 'center' },

  tabRow:   { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tabBtn:   { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderColor: C.border },
  tabText:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  stepCategory:      { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  stepCategoryInline:{ flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 },
  actives:  { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 8 },
  activePill:{ borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8 },
  activePillText:{ fontFamily: 'DMSans_400Regular', fontSize: 10 },
  useText:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#4A4039', lineHeight: 20, marginBottom: 5 },
  reasonText:{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, lineHeight: 18, fontStyle: 'italic' },
  reasonPlain:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 19, marginBottom: 8 },
  insteadText:{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#C44B4B', marginBottom: 4 },
  noMatch:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic' },

  textCard:     { backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1 },
  textCardName: { fontFamily: 'DMSans_500Medium', fontSize: 14 },
  shelfHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusPill:   { marginStart: 'auto', borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8 },
  statusText:   { fontFamily: 'DMSans_500Medium', fontSize: 10, textTransform: 'capitalize' },

  countryBadge:{ borderRadius: 10, paddingVertical: 3, paddingHorizontal: 9 },
  countryText: { fontFamily: 'DMSans_500Medium', fontSize: 11 },
  pickCard:    { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.card, borderRadius: 11, padding: 11, borderWidth: 1 },
  pickInfo:    { flex: 1 },
  pickBrand:   { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, marginBottom: 1 },
  pickName:    { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, lineHeight: 18 },
  pickMeta:    { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  pickPrice:   { fontFamily: 'DMSans_500Medium', fontSize: 11, fontWeight: '600' },
  pickRetailer:{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  shopBtn:     { borderRadius: 8, paddingVertical: 7, paddingHorizontal: 11 },
  shopBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#FFF', fontWeight: '600' },

  auditTabRow: { marginBottom: 12 },
  auditTabBtn: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 18, borderWidth: 1.5, borderColor: C.border, marginEnd: 6 },
  auditTabText:{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  addHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  auditProduct:{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, flex: 1, marginBottom: 4 },
  priorityBadge:{ borderRadius: 8, paddingVertical: 2, paddingHorizontal: 8, marginStart: 8 },
  priorityText: { fontFamily: 'DMSans_500Medium', fontSize: 10 },
});
