import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, Modal, Switch, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';
import { useApp } from '../context/AppContext';

const DAYS     = ['S','M','T','W','T','F','S'];
const DAY_FULL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function nudgeTime(time, dir) {
  const [h, m] = time.split(':').map(Number);
  const total  = ((h * 60 + m + dir * 15) % 1440 + 1440) % 1440;
  const nh = Math.floor(total / 60), nm = total % 60;
  return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
}
function formatTime(time) {
  const [h, m] = time.split(':').map(Number);
  if (h === 0)  return `12:${String(m).padStart(2,'0')} AM`;
  if (h < 12)  return `${h}:${String(m).padStart(2,'0')} AM`;
  if (h === 12) return `12:${String(m).padStart(2,'0')} PM`;
  return `${h - 12}:${String(m).padStart(2,'0')} PM`;
}

export default function SettingsScreen({ navigation }) {
  const { analysis, setAnalysis, setAnswers } = useApp();
  const era = analysis?.era;

  const [showPrompt, setShowPrompt] = useState(false);
  const [granted,    setGranted]    = useState(false);
  const [amOn,  setAmOn]  = useState(false);
  const [pmOn,  setPmOn]  = useState(false);
  const [amTime,setAmTime]= useState('08:00');
  const [pmTime,setPmTime]= useState('21:00');
  const [amDays,setAmDays]= useState([0,1,2,3,4,5,6]);
  const [pmDays,setPmDays]= useState([0,1,2,3,4,5,6]);
  const [saved,  setSaved] = useState(false);

  const toggleDay = (setter, days, i) =>
    setter(days.includes(i) ? days.filter(d => d !== i) : [...days, i]);

  function handleToggle(which) {
    if (!granted) { setShowPrompt(true); return; }
    if (which === 'am') setAmOn(v => !v);
    else setPmOn(v => !v);
  }

  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

  function retake() {
    setAnalysis(null);
    setAnswers(null);
    navigation.navigate('Quiz');
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>

        {/* Back */}
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>← Back</Text>
        </Pressable>

        <Text style={s.pageTitle}>Settings</Text>

        {/* Era card */}
        {era && (
          <View style={[s.eraCard, { backgroundColor: era.bg, borderColor: era.color + '40' }]}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>{era.emoji}</Text>
            <Text style={[s.eraName, { color: era.color }]}>{era.name}</Text>
            <Text style={s.eraSub}>Your current skin era</Text>
          </View>
        )}

        {/* Reminders */}
        <Text style={s.section}>Ritual Reminders</Text>

        {!granted ? (
          <Pressable style={s.enableCard} onPress={() => setShowPrompt(true)}>
            <Text style={s.enableText}>Enable notifications to set reminders</Text>
            <Text style={[s.enableAction, { color: era?.color || C.accent }]}>Enable →</Text>
          </Pressable>
        ) : (
          <>
            <TimeRow
              label="Morning ritual" icon="☀️"
              on={amOn} time={amTime} days={amDays} color="#B8924A"
              onToggle={() => handleToggle('am')}
              onNudge={dir => setAmTime(t => nudgeTime(t, dir))}
              onDayToggle={i => toggleDay(setAmDays, amDays, i)}
            />
            <TimeRow
              label="Evening ritual" icon="🌙"
              on={pmOn} time={pmTime} days={pmDays} color="#9B85B8"
              onToggle={() => handleToggle('pm')}
              onNudge={dir => setPmTime(t => nudgeTime(t, dir))}
              onDayToggle={i => toggleDay(setPmDays, pmDays, i)}
            />
            <Pressable
              style={[s.saveBtn, saved && s.saveBtnDone]}
              onPress={save}
            >
              <Text style={s.saveBtnText}>{saved ? '✓ Saved!' : 'Save Reminders'}</Text>
            </Pressable>
          </>
        )}

        <View style={s.divider} />

        {/* Reassess */}
        <Text style={s.section}>Reassess Your Skin</Text>
        <Text style={s.reassessDesc}>Skin changes. Retake monthly to update your era and routine.</Text>
        <Pressable style={s.retakeBtn} onPress={retake}>
          <Text style={s.retakeBtnText}>Retake Skin Era Quiz</Text>
        </Pressable>

        <View style={s.footer}>
          <Text style={s.footerLogo}>Get Pretty</Text>
          <Text style={s.footerSub}>Intelligent skincare — for the era you're in.</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Permission modal */}
      <Modal visible={showPrompt} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.dialog}>
            <View style={s.dialogBody}>
              <View style={s.dialogIcon}><Text style={{ fontSize: 26 }}>🌿</Text></View>
              <Text style={s.dialogTitle}>"Get Pretty" Would Like to Send You Notifications</Text>
              <Text style={s.dialogDesc}>Notifications may include your morning and evening ritual reminders.</Text>
            </View>
            <View style={s.dialogBtns}>
              <Pressable style={s.dialogBtn} onPress={() => setShowPrompt(false)}>
                <Text style={s.dialogBtnText}>Don't Allow</Text>
              </Pressable>
              <View style={s.dialogDivider} />
              <Pressable style={s.dialogBtn} onPress={() => { setGranted(true); setShowPrompt(false); setAmOn(true); setPmOn(true); }}>
                <Text style={[s.dialogBtnText, { fontWeight: '600' }]}>Allow</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TimeRow({ label, icon, on, time, days, color, onToggle, onNudge, onDayToggle }) {
  return (
    <View style={[tr.card, { borderColor: on ? color + '50' : C.border }]}>
      <View style={tr.topRow}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={tr.label}>{label}</Text>
          <Text style={[tr.timeSmall, { color: on ? color : C.muted }]}>{on ? formatTime(time) : 'Off'}</Text>
        </View>
        <Switch value={on} onValueChange={onToggle} trackColor={{ true: color }} thumbColor="#FFF" />
      </View>
      {on && (
        <>
          <View style={tr.sep} />
          <View style={tr.nudgeRow}>
            <Pressable style={tr.nudgeBtn} onPress={() => onNudge(-1)}><Text style={tr.nudgeTxt}>−</Text></Pressable>
            <View style={{ alignItems: 'center' }}>
              <Text style={[tr.timeLarge, { color }]}>{formatTime(time)}</Text>
              <Text style={tr.nudgeHint}>tap − / + to adjust by 15 min</Text>
            </View>
            <Pressable style={tr.nudgeBtn} onPress={() => onNudge(1)}><Text style={tr.nudgeTxt}>+</Text></Pressable>
          </View>
          <View style={tr.sep} />
          <View style={tr.daysSection}>
            <Text style={tr.repeatLabel}>REPEAT</Text>
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
              {days.length === 7 ? 'Every day' : days.length === 0 ? 'No days selected' : days.map(d => DAY_FULL[d]).join(', ')}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  content:   { padding: 24, paddingTop: 18 },
  backBtn:   { marginBottom: 16 },
  backText:  { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.accent },
  pageTitle: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: C.text, marginBottom: 20 },
  eraCard:   { borderWidth: 1.5, borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 28 },
  eraName:   { fontFamily: 'CormorantGaramond_500Medium', fontSize: 17, marginBottom: 4 },
  eraSub:    { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted },
  section:   { fontFamily: 'DMSans_500Medium', fontSize: 13, color: C.text, marginBottom: 12, marginTop: 4 },
  enableCard:{ backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  enableText:{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.text },
  enableAction:{ fontFamily: 'DMSans_500Medium', fontSize: 13 },
  saveBtn:   { backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 28 },
  saveBtnDone:{ backgroundColor: '#7A9E6E' },
  saveBtnText:{ fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF8F5' },
  divider:   { height: 1, backgroundColor: C.border, marginBottom: 28 },
  reassessDesc:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 19, marginBottom: 14 },
  retakeBtn: { borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  retakeBtnText:{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#6B5E57' },
  footer:    { marginTop: 40, alignItems: 'center' },
  footerLogo:{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 17, color: '#D4CBC4', letterSpacing: 2 },
  footerSub: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#D4CBC4', fontStyle: 'italic', marginTop: 4 },
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
