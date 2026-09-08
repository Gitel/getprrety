import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { C } from '../constants';
import { api } from '../lib/api';
import { uploadImage } from '../lib/uploadImage';

export default function ProductCameraScreen({ navigation }) {
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);

  async function selectPhoto(source) {
    try {
      const result = await Camera.getPhoto({
        source,
        quality: 70,
        resultType: CameraResultType.DataUrl,
        correctOrientation: true,
      });
      if (result.dataUrl) setPhoto(result.dataUrl);
    } catch {
      // Closing the native camera or library is not an error the user needs to see.
    }
  }

  async function saveProduct() {
    if (!photo || saving) return;
    setSaving(true);
    try {
      const uploadId = await uploadImage(photo);
      await api.post('/api/products', { uploadId, category: 'unclassified' });
      Alert.alert('Product saved', 'The product photo was added to your log.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not save product', error.message);
      setSaving(false);
    }
  }

  if (photo) {
    return (
      <View style={s.preview}>
        <Image source={{ uri: photo }} style={s.image} resizeMode="contain" />
        <SafeAreaView style={s.previewActions}>
          <Pressable style={s.retake} onPress={() => setPhoto(null)} disabled={saving}>
            <Text style={s.retakeText}>Retake</Text>
          </Pressable>
          <Pressable style={s.save} onPress={saveProduct} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={s.saveText}>Save product</Text>}
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <Pressable onPress={() => navigation.goBack()} style={s.back}>
        <Text style={s.backText}>← Back</Text>
      </Pressable>
      <View style={s.container}>
        <Text style={s.emoji}>📦</Text>
        <Text style={s.title}>Scan a product</Text>
        <Text style={s.description}>Take a clear photo of the product label, or choose one from your library.</Text>
        <Pressable style={s.cameraButton} onPress={() => selectPhoto(CameraSource.Camera)}>
          <Text style={s.cameraText}>Take a photo</Text>
        </Pressable>
        <Pressable style={s.libraryButton} onPress={() => selectPhoto(CameraSource.Photos)}>
          <Text style={s.libraryText}>Choose from library</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  back: { position: 'absolute', top: 20, left: 24, zIndex: 1 },
  backText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.accent },
  emoji: { fontSize: 52, marginBottom: 20 },
  title: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, marginBottom: 14 },
  description: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 23, marginBottom: 34 },
  cameraButton: { width: '100%', backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  cameraText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
  libraryButton: { width: '100%', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  libraryText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.text },
  preview: { flex: 1, backgroundColor: '#000' },
  image: { flex: 1, width: '100%' },
  previewActions: { flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingBottom: 28 },
  retake: { flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  retakeText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
  save: { flex: 1, backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  saveText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
});
