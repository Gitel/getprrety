import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { formatTime, weekdayLetters, weekdayNames } from '../lib/formatting';
import { loadReminderSchedule, requestNotificationPermission, saveReminderSchedule, supportsNotifications } from '../lib/notifications';

function nudgeTime(time, dir) {
  const [h, m] = time.split(':').map(Number);
  const total  = ((h * 60 + m + dir * 15) % 1440 + 1440) % 1440;
  const nh = Math.floor(total / 60), nm = total % 60;
  return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
}

export default function NotificationSetupScreen({ navigation }) {
  const { analysis } = useApp();
  // Texts: src/locales/<lang>/onboarding.json (notifications.*). Times/days: src/lib/formatting.js.
  const { t } = useTranslation();
  const era = analysis?.era;

  const [granted,    setGranted]    = useState(false);
  const [amOn,  setAmOn]  = useState(false);
  const [pmOn,  setPmOn]  = useState(false);
  const [amTime,setAmTime]= useState('08:00');
  const [pmTime,setPmTime]= useState('21:00');
  const [amDays,setAmDays]= useState([0,1,2,3,4,5,6]);
  const [pmDays,setPmDays]= useState([0,1,2,3,4,5,6]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadReminderSchedule().then(({ granted: allowed, settings }) => {
      setGranted(allowed);
      if (!settings) return;
      setAmOn(settings.amOn);
      setPmOn(settings.pmOn);
      setAmTime(settings.amTime);
      setPmTime(settings.pmTime);
      setAmDays(settings.amDays);
      setPmDays(settings.pmDays);
    }).catch(() => {});
  }, []);

  const toggleDay = (setter, days, i) =>
    setter(days.includes(i) ? days.filter(d => d !== i) : [...days, i]);

  async function enableNotifications() {
    if (!supportsNotifications()) {
      Alert.alert('Mobile only', 'Ritual reminders are available in the iOS and Android apps.');
      return;
    }
    const allowed = await requestNotificationPermission().catch(() => false);
    setGranted(allowed);
    if (allowed) {
      setAmOn(true);
      setPmOn(true);
    } else {
      Alert.alert('Notifications are off', 'You can enable notifications for Get Pretty in your device Settings.');
    }
  }

  async function saveAndContinue() {
    if (!granted) {
      navigation.navigate('Home');
      return;
    }
    setSaving(true);
    try {
      await saveReminderSchedule({ amOn, pmOn, amTime, pmTime, amDays, pmDays });
      navigation.navigate('Home');
    } catch (err) {
      Alert.alert('Could not save reminders', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        {navigation.canGoBack() && (
          <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={10}>
            <Text style={s.backText}>{t('common:back')}</Text>
          </Pressable>
        )}

        <View style={s.header}>
          <Text style={s.emoji}>🔔</Text>
          <Text style={s.title}>{t('onboarding:notifications.title')}</Text>
          <Text style={s.subtitle}>{t('onboarding:notifications.subtitle')}</Text>
        </View>

        {!granted ? (
          <View style={[s.permCard, { backgroundColor: era?.bg, borderColor: (era?.color || C.accent) + '40' }]}>
            <Text style={[s.permTitle, { color: era?.color || C.accent }]}>{t('onboarding:notifications.permTitle')}</Text>
            <Text style={s.permDesc}>{t('onboarding:notifications.permDesc')}</Text>
            <Pressable
              style={[s.permBtn, { backgroundColor: era?.color || C.accent }]}
              onPress={enableNotifications}
            >
              <Text style={s.permBtnText}>{t('onboarding:notifications.permBtn')}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.pickers}>
            <TimeRow
              label={t('onboarding:notifications.morning')} icon="☀️"
              on={amOn} time={amTime} days={amDays} color="#B8924A"
              onToggle={() => setAmOn(v => !v)}
              onNudge={dir => setAmTime(prev => nudgeTime(prev, dir))}
              onDayToggle={i => toggleDay(setAmDays, amDays, i)}
            />
            <TimeRow
              label={t('onboarding:notifications.evening')} icon="🌙"
              on={pmOn} time={pmTime} days={pmDays} color="#9B85B8"
              onToggle={() => setPmOn(v => !v)}
              onNudge={dir => setPmTime(prev => nudgeTime(prev, dir))}
              onDayToggle={i => toggleDay(setPmDays, pmDays, i)}
            />
          </View>
        )}

        <View style={{ flex: 1 }} />

        <Pressable
          style={[s.cta, { backgroundColor: granted ? (era?.color || C.accent) : '#2C2C2C' }]}
          onPress={saveAndContinue}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#FFF" />
            : <Text style={s.ctaText}>{granted ? t('onboarding:notifications.ctaSave') : t('onboarding:notifications.ctaLater')}</Text>}
        </Pressable>
        {!granted && <Text style={s.hint}>{t('onboarding:notifications.hint')}</Text>}

        <View style={{ height: 20 }} />
      </View>

    </SafeAreaView>
  );
}

function TimeRow({ label, icon, on, time, days, color, onToggle, onNudge, onDayToggle }) {
  const { t, i18n } = useTranslation();
  // Weekday chips / names in the current language (Sunday first; index = day number used by the schedule).
  const DAYS     = weekdayLetters(i18n.language);
  const DAY_FULL = weekdayNames(i18n.language);
  return (
    <View style={[tr.card, { borderColor: on ? color + '50' : C.border }]}>
      <View style={tr.topRow}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
        <View style={{ flex: 1, marginStart: 12 }}>
          <Text style={tr.label}>{label}</Text>
          <Text style={[tr.timeSmall, { color: on ? color : C.muted }]}>{on ? formatTime(time, i18n.language) : t('onboarding:notifications.off')}</Text>
        </View>
        <Switch value={on} onValueChange={onToggle} trackColor={{ true: color }} thumbColor="#FFF" />
      </View>
      {on && (
        <>
          <View style={tr.sep} />
          <View style={tr.nudgeRow}>
            <Pressable style={tr.nudgeBtn} onPress={() => onNudge(-1)}><Text style={tr.nudgeTxt}>−</Text></Pressable>
            <View style={{ alignItems: 'center' }}>
              <Text style={[tr.timeLarge, { color }]}>{formatTime(time, i18n.language)}</Text>
              <Text style={tr.nudgeHint}>{t('onboarding:notifications.nudgeHint')}</Text>
            </View>
            <Pressable style={tr.nudgeBtn} onPress={() => onNudge(1)}><Text style={tr.nudgeTxt}>+</Text></Pressable>
          </View>
          <View style={tr.sep} />
          <View style={tr.daysSection}>
            <Text style={tr.repeatLabel}>{t('onboarding:notifications.repeat')}</Text>
            <View style={tr.daysRow}>
              {DAYS.map((d, i) => {
                const on2 = days.includes(i);
                return (
                  <Pressable key={i} onPress={() => onDayToggle(i)} style={[tr.dayBtn, on2 && { backgroundColor: color }]}>
                    <Text style={[tr.dayTxt, on2 && { color: '#FFF', fontWeight: '600' }]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={tr.daysLabel}>
              {days.length === 7 ? t('onboarding:notifications.everyDay') : days.length === 0 ? t('onboarding:notifications.noDays') : days.map(d => DAY_FULL[d]).join(', ')}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, padding: 24, paddingTop: 28 },
  backBtn:   { marginBottom: 16 },
  backText:  { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.accent },
  header:    { alignItems: 'center', marginBottom: 28 },
  emoji:     { fontSize: 48, marginBottom: 14 },
  title:     { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.text, marginBottom: 8 },
  subtitle:  { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, lineHeight: 23, textAlign: 'center' },
  permCard:  { borderWidth: 1.5, borderRadius: 16, padding: 24, marginBottom: 24, alignItems: 'center' },
  permTitle: { fontFamily: 'DMSans_500Medium', fontSize: 15, marginBottom: 8 },
  permDesc:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6B5E57', lineHeight: 21, marginBottom: 20, textAlign: 'center' },
  permBtn:   { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  permBtnText:{ fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#FFF' },
  pickers:   { gap: 0 },
  cta:       { borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  ctaText:   { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF', letterSpacing: 0.4 },
  hint:      { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, textAlign: 'center', fontStyle: 'italic' },
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  dialog:    { backgroundColor: '#F2F2F7', borderRadius: 14, overflow: 'hidden', width: '100%', maxWidth: 320 },
  dialogBody:{ padding: 24, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.12)' },
  dialogIcon:{ width: 56, height: 56, borderRadius: 14, backgroundColor: '#C4957A', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  dialogTitle:{ fontSize: 17, color: '#000', fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  dialogDesc: { fontSize: 13, color: '#6C6C70', lineHeight: 20, textAlign: 'center' },
  dialogBtns: { flexDirection: 'row' },
  dialogBtn:  { flex: 1, padding: 14, alignItems: 'center' },
  dialogBtnText:{ fontSize: 17, color: '#007AFF' },
  dialogDivider:{ width: 1, backgroundColor: 'rgba(0,0,0,0.12)' },
});

const tr = StyleSheet.create({
  card:      { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden', marginBottom: 12, backgroundColor: C.card },
  topRow:    { flexDirection: 'row', alignItems: 'center', padding: 14 },
  label:     { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 1 },
  timeSmall: { fontFamily: 'DMSans_400Regular', fontSize: 11 },
  sep:       { height: 1, backgroundColor: C.border },
  nudgeRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 20 },
  nudgeBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  nudgeTxt:  { fontSize: 18, color: C.text },
  timeLarge: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, letterSpacing: 1 },
  nudgeHint: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, marginTop: 2 },
  daysSection:{ padding: 12 },
  repeatLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, letterSpacing: 0.5, marginBottom: 10 },
  daysRow:   { flexDirection: 'row', gap: 6, justifyContent: 'space-between', marginBottom: 8 },
  dayBtn:    { width: 34, height: 34, borderRadius: 17, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  dayTxt:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  daysLabel: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
});
