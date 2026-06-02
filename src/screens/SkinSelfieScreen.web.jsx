import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';

export default function SkinSelfieScreen({ navigation }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>📸</Text>
        <Text style={s.title}>Skin selfie</Text>
        <Text style={s.desc}>
          {'Camera access works best in the mobile app.\n\nYou can skip this step for now and complete it on your phone.'}
        </Text>
        <Pressable style={s.btn} onPress={() => navigation.navigate('Notifications')}>
          <Text style={s.btnText}>Continue →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emoji:     { fontSize: 52, marginBottom: 20 },
  title:     { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: C.text, marginBottom: 14 },
  desc:      { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  btn:       { width: '100%', backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  btnText:   { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF7F4', letterSpacing: 0.4 },
});
