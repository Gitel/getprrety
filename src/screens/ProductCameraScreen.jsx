import React, { useState, useRef } from 'react';
import {
  ActivityIndicator, View, Text, Pressable, StyleSheet, Image, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useCameraPermission } from '../hooks/useCameraPermission';
import { C } from '../constants';
import { uploadImage } from '../lib/uploadImage';
import { api } from '../lib/api';

// ─── Permission denied fallback ───────────────────────────────────────────────
function PermissionDenied({ onUpload, onBack }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.introContainer}>
        <Text style={s.introEmoji}>📦</Text>
        <Text style={s.introTitle}>Camera access needed</Text>
        <Text style={s.introDesc}>
          {'We need camera access to scan your products.\n\nEnable it in:\niPhone Settings → Get Pretty → Camera'}
        </Text>
        <Pressable style={s.cta} onPress={() => Linking.openSettings()}>
          <Text style={s.ctaText}>Open Settings</Text>
        </Pressable>
        <Pressable style={s.ctaGhost} onPress={onUpload}>
          <Text style={s.ctaGhostText}>Upload a photo instead</Text>
        </Pressable>
        <Pressable onPress={onBack} style={{ marginTop: 16 }}>
          <Text style={s.backText}>← Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ProductCameraScreen({ navigation }) {
  const { granted, ensurePermission } = useCameraPermission();
  const cameraRef = useRef(null);

  const [phase,    setPhase]    = useState('camera');  // camera | preview | denied
  const [photoUri, setPhotoUri] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleMount() {
    const ok = await ensurePermission();
    if (!ok) setPhase('denied');
  }

  async function capturePhoto() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    setPhotoUri(photo.uri);
    setPhase('preview');
  }

  async function pickFromLibrary() {
    const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!res.granted) {
      Alert.alert('Permission needed', 'Enable photo library access in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
      setPhase('preview');
    }
  }

  function retake() {
    setPhotoUri(null);
    setPhase('camera');
  }

  async function confirm() {
    if (!photoUri || saving) return;
    setSaving(true);
    try {
      const uploadId = await uploadImage(photoUri);
      await api.post('/api/products', { uploadId, category: 'unclassified' });
      Alert.alert('Product saved', 'The product photo was added to your log.', [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Could not save product', err.message);
      setSaving(false);
    }
  }

  if (phase === 'denied') {
    return (
      <PermissionDenied
        onUpload={pickFromLibrary}
        onBack={() => navigation.goBack()}
      />
    );
  }

  if (phase === 'preview') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Image source={{ uri: photoUri }} style={{ flex: 1 }} resizeMode="contain" />
        <SafeAreaView style={s.previewActions}>
          <Pressable style={s.retakeBtn} onPress={retake} disabled={saving}>
            <Text style={s.retakeBtnText}>Retake</Text>
          </Pressable>
          <Pressable style={s.confirmBtn} onPress={confirm} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={s.confirmBtnText}>Save product →</Text>}
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  // ── Camera ──
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
        onCameraReady={handleMount}
      >
        {/* Top hint */}
        <SafeAreaView style={s.cameraTop}>
          <Text style={s.cameraHint}>Point at your product label 📦</Text>
        </SafeAreaView>

        {/* Back button */}
        <SafeAreaView style={s.backWrap}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={s.backBtnText}>✕</Text>
          </Pressable>
        </SafeAreaView>

        {/* Square scanner frame */}
        <View style={s.frameWrap} pointerEvents="none">
          <View style={s.frame}>
            {/* Corner markers */}
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
          </View>
          <Text style={s.frameLabel}>Align product label within frame</Text>
        </View>

        {/* Bottom controls */}
        <SafeAreaView style={s.cameraBottom}>
          {/* Gallery picker */}
          <Pressable style={s.galleryBtn} onPress={pickFromLibrary}>
            <Text style={s.galleryIcon}>🖼</Text>
          </Pressable>
          {/* Capture */}
          <Pressable style={s.captureBtn} onPress={capturePhoto}>
            <View style={s.captureBtnInner} />
          </Pressable>
          {/* Spacer to balance layout */}
          <View style={s.galleryBtn} />
        </SafeAreaView>
      </CameraView>
    </View>
  );
}

const CORNER_SIZE = 20;
const CORNER_THICK = 3;

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: '#FAF7F4' },
  introContainer:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  introEmoji:      { fontSize: 52, marginBottom: 20 },
  introTitle:      { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: '#2C2C2C', textAlign: 'center', marginBottom: 14 },
  introDesc:       { fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#9B8E85', textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  cta:             { width: '100%', backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  ctaText:         { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF', letterSpacing: 0.4 },
  ctaGhost:        { width: '100%', borderWidth: 1.5, borderColor: '#E8DDD8', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaGhostText:    { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#9B8E85' },
  backText:        { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.accent },

  cameraTop:       { paddingHorizontal: 24, paddingTop: 16, alignItems: 'center' },
  cameraHint:      { fontFamily: 'CormorantGaramond_500Medium', fontSize: 18, color: '#FFF', textAlign: 'center' },

  backWrap:        { position: 'absolute', top: 0, left: 0, padding: 16 },
  backBtnText:     { fontSize: 22, color: 'rgba(255,255,255,0.8)' },

  frameWrap:       { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frame:           { width: 240, height: 240, borderRadius: 8, position: 'relative' },
  frameLabel:      { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 14 },

  // Corner markers — Terracotta L-shapes
  corner:          { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: '#C9897A' },
  cornerTL:        { top: 0, left: 0, borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
  cornerTR:        { top: 0, right: 0, borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },
  cornerBL:        { bottom: 0, left: 0, borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
  cornerBR:        { bottom: 0, right: 0, borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },

  cameraBottom:    { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 40, paddingBottom: 40 },
  galleryBtn:      { width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  galleryIcon:     { fontSize: 22 },
  captureBtn:      { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFF' },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF' },

  previewActions:  { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 40, gap: 12 },
  retakeBtn:       { flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  retakeBtnText:   { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
  confirmBtn:      { flex: 1, backgroundColor: '#C9897A', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  confirmBtnText:  { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
});
