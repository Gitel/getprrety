import React, { useState, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView } from 'expo-camera';
import { useCameraPermission } from '../hooks/useCameraPermission';
import { C } from '../constants';
import { api } from '../lib/api';
import { uploadAll } from '../lib/uploadImage';

// ─── Intro screen shown before camera opens ───────────────────────────────────
function IntroScreen({ onReady }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.introContainer}>
        <Text style={s.introEmoji}>✨</Text>
        <Text style={s.introTitle}>Time for your skin selfie</Text>
        <Text style={s.introDesc}>
          {'No makeup, no filters — just you.\nNatural daylight, hair tied back, neutral expression.'}
        </Text>
        <Pressable style={s.cta} onPress={onReady}>
          <Text style={s.ctaText}>I'm ready →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Permission denied fallback ───────────────────────────────────────────────
function PermissionDenied({ onUploadInstead }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.introContainer}>
        <Text style={s.introEmoji}>📷</Text>
        <Text style={s.introTitle}>Camera access needed</Text>
        <Text style={s.introDesc}>
          {'We need camera access to analyze your skin.\n\nEnable it in:\niPhone Settings → Get Pretty → Camera'}
        </Text>
        <Pressable style={s.cta} onPress={() => Linking.openSettings()}>
          <Text style={s.ctaText}>Open Settings</Text>
        </Pressable>
        <Pressable style={s.ctaGhost} onPress={onUploadInstead}>
          <Text style={s.ctaGhostText}>Upload a photo instead</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function SkinSelfieScreen({ navigation }) {
  const { granted, ensurePermission } = useCameraPermission();
  const cameraRef = useRef(null);

  const [phase,   setPhase]   = useState('intro');   // intro | camera | preview | denied
  const [photos,  setPhotos]  = useState({});         // { right, left, front }
  const [current, setCurrent] = useState('front');    // which angle we're capturing

  const ANGLES = [
    { key: 'front',   label: 'Straight on',          hint: 'Face forward, chin slightly down' },
    { key: 'left',    label: 'Left side of face',    hint: 'Turn your left cheek toward the light' },
    { key: 'right',   label: 'Right side of face',   hint: 'Turn your right cheek toward the light' },
    { key: 'closeup', label: 'Close-up',             hint: 'Move closer — fill the frame with your skin texture' },
    { key: 'neck',    label: 'Neck',                 hint: 'Tilt your chin up slightly to show your neck' },
  ];

  const currentAngle = ANGLES.find(a => a.key === current);
  const capturedCount = Object.keys(photos).length;

  async function openCamera() {
    const ok = await ensurePermission();
    if (!ok) { setPhase('denied'); return; }
    setPhase('camera');
  }

  async function capturePhoto() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    setPhotos(p => ({ ...p, [current]: photo.uri }));
    setPhase('preview');
  }

  function retake() {
    setPhotos(p => { const n = { ...p }; delete n[current]; return n; });
    setPhase('camera');
  }

  function confirm() {
    const next = ANGLES.find(a => !photos[a.key] && a.key !== current);
    if (next) {
      setCurrent(next.key);
      setPhase('camera');
    } else {
      saveSelfies(photos);
      navigation.navigate('ShelfPhotos');
    }
  }

  function saveSelfies(capturedPhotos) {
    const uris = ANGLES.map(a => capturedPhotos[a.key]).filter(Boolean);
    uploadAll(uris)
      .then(selfiePhotoIds => api.patch('/api/profile', { selfiePhotoIds }))
      .catch(() => {});
  }

  // ── Intro ──
  if (phase === 'intro') {
    return <IntroScreen onReady={openCamera} />;
  }

  // ── Permission denied ──
  if (phase === 'denied') {
    return (
      <PermissionDenied
        onUploadInstead={() => navigation.navigate('ShelfPhotos')}
      />
    );
  }

  // ── Camera ──
  if (phase === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          facing="front"
        >
          {/* Top copy */}
          <SafeAreaView style={s.cameraTop}>
            <Text style={s.cameraHint}>Natural light, no filter — your skin, honestly ✨</Text>
            <Text style={s.cameraAngle}>{currentAngle?.label}</Text>
            <Text style={s.cameraAngleHint}>{currentAngle?.hint}</Text>
          </SafeAreaView>

          {/* Oval guide overlay */}
          <View style={s.ovalWrap} pointerEvents="none">
            <View style={s.oval} />
            <Text style={s.ovalLabel}>Center your face here</Text>
          </View>

          {/* Progress dots */}
          <View style={s.dotRow} pointerEvents="none">
            {ANGLES.map(a => (
              <View
                key={a.key}
                style={[s.dot, photos[a.key] && s.dotDone, a.key === current && s.dotActive]}
              />
            ))}
          </View>

          {/* Capture button */}
          <SafeAreaView style={s.cameraBottom}>
            <Pressable style={s.captureBtn} onPress={capturePhoto}>
              <View style={s.captureBtnInner} />
            </Pressable>
            {capturedCount > 0 && (
              <Pressable onPress={() => { saveSelfies(photos); navigation.navigate('ShelfPhotos'); }} style={s.skipBtn}>
                <Text style={s.skipText}>Skip remaining →</Text>
              </Pressable>
            )}
          </SafeAreaView>
        </CameraView>
      </View>
    );
  }

  // ── Preview ──
  if (phase === 'preview') {
    const uri = photos[current];
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Image source={{ uri }} style={{ flex: 1 }} resizeMode="cover" />
        <SafeAreaView style={s.previewActions}>
          <Pressable style={s.retakeBtn} onPress={retake}>
            <Text style={s.retakeBtnText}>Retake</Text>
          </Pressable>
          <Pressable style={s.confirmBtn} onPress={confirm}>
            <Text style={s.confirmBtnText}>
              {ANGLES.find(a => !photos[a.key] && a.key !== current) ? 'Next angle →' : 'Looks good →'}
            </Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return null;
}

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: '#FAF7F4' },
  introContainer:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  introEmoji:      { fontSize: 52, marginBottom: 20 },
  introTitle:      { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: '#2C2C2C', textAlign: 'center', marginBottom: 14 },
  introDesc:       { fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#9B8E85', textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  cta:             { width: '100%', backgroundColor: '#C9897A', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  ctaText:         { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF7F4', letterSpacing: 0.4 },
  ctaGhost:        { width: '100%', borderWidth: 1.5, borderColor: '#E8DDD8', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaGhostText:    { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#9B8E85' },

  cameraTop:       { paddingHorizontal: 24, paddingTop: 16, alignItems: 'center' },
  cameraHint:      { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontStyle: 'italic', marginBottom: 8 },
  cameraAngle:     { fontFamily: 'CormorantGaramond_500Medium', fontSize: 20, color: '#FFF', marginBottom: 4 },
  cameraAngleHint: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.65)', textAlign: 'center' },

  ovalWrap:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  oval:            { width: 220, height: 280, borderRadius: 110, borderWidth: 2.5, borderColor: '#C9897A', borderStyle: 'dashed' },
  ovalLabel:       { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 12 },

  dotRow:          { position: 'absolute', bottom: 140, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot:             { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotDone:         { backgroundColor: '#7A9E6E' },
  dotActive:       { backgroundColor: '#C9897A', width: 20 },

  cameraBottom:    { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingBottom: 40 },
  captureBtn:      { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFF', marginBottom: 16 },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF' },
  skipBtn:         {},
  skipText:        { fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.65)' },

  previewActions:  { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 40, gap: 12 },
  retakeBtn:       { flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  retakeBtnText:   { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
  confirmBtn:      { flex: 1, backgroundColor: '#C9897A', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  confirmBtnText:  { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
});
