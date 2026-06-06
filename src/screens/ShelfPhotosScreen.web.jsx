import React, { useState, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';
import { api } from '../lib/api';
import { uploadAll } from '../lib/uploadImage';

export default function ShelfPhotosScreen({ navigation }) {
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  // Unconditional refs — no hooks in loops
  const inputRefs   = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];
  const captureRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];

  function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => setPhotos(p => [...p, ev.target.result]);
    reader.readAsDataURL(file);
  }

  async function handleContinue() {
    if (photos.length > 0) {
      setSaving(true);
      uploadAll(photos)
        .then(shelfPhotoIds => api.patch('/api/profile', { shelfPhotoIds }))
        .catch(() => {})
        .finally(() => setSaving(false));
    }
    navigation.navigate('Notifications');
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>🧴</Text>
        <Text style={s.title}>Your product shelf</Text>
        <Text style={s.sub}>Share what you're currently using · optional, up to 5</Text>

        <View style={s.grid}>
          {Array.from({ length: 5 }).map((_, i) => {
            const filled = i < photos.length;
            const isNext = i === photos.length && photos.length < 5;
            if (filled) return (
              <View key={i} style={[s.slot, s.slotFilled]}>
                <Image source={{ uri: photos[i] }} style={{ width: '100%', height: '100%', borderRadius: 10 }} resizeMode="cover" />
                <Pressable
                  style={s.removeBtn}
                  onPress={() => setPhotos(p => p.filter((_, j) => j !== i))}
                >
                  <View style={s.removeBadge}>
                    <Text style={{ fontSize: 11, color: '#FFF', lineHeight: 16 }}>✕</Text>
                  </View>
                </Pressable>
              </View>
            );
            if (isNext) return (
              <View key={i} style={s.slotNext}>
                <Pressable style={s.addBtn} onPress={() => captureRefs[i].current.click()}>
                  <Text style={s.addBtnText}>📷</Text>
                </Pressable>
                <Pressable style={s.addBtn} onPress={() => inputRefs[i].current.click()}>
                  <Text style={s.addBtnText}>🖼</Text>
                </Pressable>
              </View>
            );
            return <View key={i} style={s.slotEmpty} />;
          })}
        </View>

        <Pressable
          style={[s.cta, saving && s.ctaDisabled]}
          disabled={saving}
          onPress={handleContinue}
        >
          <Text style={s.ctaText}>{photos.length > 0 ? 'Continue →' : 'Skip for now →'}</Text>
        </Pressable>
      </View>

      {inputRefs.map((ref, i) => (
        <React.Fragment key={`shelf-${i}`}>
          <input type="file" accept="image/*" ref={ref} style={{ display: 'none' }} onChange={onFileChange} />
          <input type="file" accept="image/*" capture="environment" ref={captureRefs[i]} style={{ display: 'none' }} onChange={onFileChange} />
        </React.Fragment>
      ))}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: C.bg },
  container:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emoji:      { fontSize: 48, marginBottom: 16 },
  title:      { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: C.text, textAlign: 'center', marginBottom: 8 },
  sub:        { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 21, marginBottom: 32 },

  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28, width: '100%', justifyContent: 'center' },
  slot:       { width: '30%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  slotFilled: { backgroundColor: '#7A9E6E20', borderWidth: 1.5, borderColor: '#7A9E6E50' },
  slotNext:   { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, overflow: 'hidden' },
  slotEmpty:  { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#F9F7F4' },
  removeBtn:  { position: 'absolute', top: 4, right: 4 },
  removeBadge:{ width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  addBtn:     { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: C.border },
  addBtnText: { fontSize: 18 },

  cta:        { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaDisabled:{ backgroundColor: '#D4CBC4' },
  ctaText:    { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
});
