import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { C } from '../constants';
import { api } from '../lib/api';
import { uploadAll } from '../lib/uploadImage';

export default function ShelfPhotosScreen({ navigation }) {
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  async function addPhoto(useCamera) {
    if (useCamera) {
      const res = await ImagePicker.requestCameraPermissionsAsync();
      if (!res.granted) {
        Alert.alert('Permission needed', 'Enable camera access in Settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (!result.canceled) setPhotos(p => [...p, result.assets[0].uri]);
    } else {
      const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!res.granted) {
        Alert.alert('Permission needed', 'Enable photo library access in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      if (!result.canceled) setPhotos(p => [...p, result.assets[0].uri]);
    }
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
                <Text style={{ fontSize: 24 }}>🧴</Text>
                <Text style={s.addedText}>Added</Text>
                <Pressable
                  style={s.removeBtn}
                  onPress={() => setPhotos(p => p.filter((_, j) => j !== i))}
                >
                  <Text style={{ fontSize: 12, color: C.muted }}>✕</Text>
                </Pressable>
              </View>
            );
            if (isNext) return (
              <View key={i} style={s.slotNext}>
                <Pressable style={s.addBtn} onPress={() => addPhoto(true)}>
                  <Text style={s.addBtnText}>📷</Text>
                </Pressable>
                <Pressable style={s.addBtn} onPress={() => addPhoto(false)}>
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
  slot:       { width: '30%', aspectRatio: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  slotFilled: { backgroundColor: '#7A9E6E20', borderWidth: 1.5, borderColor: '#7A9E6E50' },
  slotNext:   { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, overflow: 'hidden' },
  slotEmpty:  { width: '30%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#F9F7F4' },
  addedText:  { fontFamily: 'DMSans_400Regular', fontSize: 10, color: '#7A9E6E' },
  removeBtn:  { position: 'absolute', top: 4, right: 6 },
  addBtn:     { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: C.border },
  addBtnText: { fontSize: 18 },

  cta:        { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaDisabled:{ backgroundColor: '#D4CBC4' },
  ctaText:    { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
});
