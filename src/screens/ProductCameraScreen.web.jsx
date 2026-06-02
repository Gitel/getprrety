import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';

export default function ProductCameraScreen({ navigation }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Pressable onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backText}>← Back</Text>
        </Pressable>
        <Text style={s.emoji}>📦</Text>
        <Text style={s.title}>Scan a product</Text>
        <Text style={s.desc}>
          {'Product scanning works best in the mobile app.\n\nOpen Get Pretty on your phone to scan product labels.'}
        </Text>
        <Pressable style={s.btn} onPress={() => navigation.goBack()}>
          <Text style={s.btnText}>Got it</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  back:      { position: 'absolute', top: 24, left: 24 },
  backText:  { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.accent },
  emoji:     { fontSize: 52, marginBottom: 20 },
  title:     { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: C.text, marginBottom: 14 },
  desc:      { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  btn:       { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  btnText:   { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
});
