import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';
import { MenuButton } from '../components/SideMenu';
import { useApp } from '../context/AppContext';
import {
  fetchThread, markThreadRead, sendReply, MAX_MESSAGE_LENGTH, MESSAGES_POLL_MS,
} from '../lib/messages';

// Two-way chat with the clinic. Clinic messages are written in the admin dashboard
// (/admin, user page); the user's replies appear there and are emailed to the clinic.
// There is no push delivery: this screen polls every MESSAGES_POLL_MS while it is open,
// and Home's unread badge refreshes when the app resumes.
export default function MessagesScreen({ navigation }) {
  const { analysis, setUnreadMessages } = useApp();
  const accent = analysis?.era?.color || C.accent;

  const [thread, setThread] = useState(null);     // null = still loading the first time
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const scrollRef = useRef(null);

  // Load now, then poll. `cancelled` stops a slow response from updating a closed screen.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const messages = await fetchThread();
        if (cancelled) return;
        setThread(messages);
        setLoadFailed(false);
        // The user is looking at the thread, so unread clinic messages are now read.
        if (messages.some(m => m.from === 'admin' && !m.readAt)) await markThreadRead();
        if (!cancelled) setUnreadMessages(0);
      } catch {
        if (cancelled) return;
        setLoadFailed(true);
        setThread(current => current || []); // keep what we have; the next poll retries
      }
    }
    load();
    const timer = setInterval(load, MESSAGES_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await sendReply(body);
      setThread(current => [...(current || []), message]);
      setDraft('');
    } catch (err) {
      // The server's own words for an empty / too-long message or the hourly limit.
      setSendError(err?.message || 'Could not send your message. Please try again.');
    } finally {
      setSending(false);
    }
  }

  const canSend = Boolean(draft.trim()) && !sending;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        {/* Top row: [menu button] Back. A row mirrors automatically in RTL. */}
        <View style={s.topRow}>
          <MenuButton onPress={navigation.openMenu} color={accent} />
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={[s.backText, { color: accent }]}>{'\u2190 Back'}</Text>
          </Pressable>
        </View>
        <Text style={s.pageTitle}>Your clinic</Text>
        <Text style={s.subtitle}>Questions about your skin or your routine? Write to your clinic here.</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.threadScroll}
        contentContainerStyle={s.thread}
        // Keep the newest message in view as the thread loads or grows.
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {thread === null && <Text style={s.muted}>{'Loading\u2026'}</Text>}
        {thread !== null && thread.length === 0 && (
          <Text style={s.muted}>{loadFailed ? 'Could not load your messages. Check your connection.' : 'No messages yet. Write to your clinic below.'}</Text>
        )}
        {(thread || []).map(m => {
          const mine = m.from === 'user';
          return (
            <View key={m.id} style={[s.bubble, mine ? [s.mine, { backgroundColor: accent + '22' }] : s.theirs]}>
              <Text style={s.sender}>{`${mine ? 'You' : 'Your clinic'} \u00B7 ${formatTime(m.createdAt)}`}</Text>
              <Text style={s.body}>{m.body}</Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={s.composer}>
        {sendError && <Text style={s.error}>{sendError}</Text>}
        <View style={s.composeRow}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={C.muted}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
          />
          <Pressable
            onPress={send}
            disabled={!canSend}
            style={[s.sendBtn, { backgroundColor: accent }, !canSend && { opacity: 0.5 }]}
          >
            <Text style={s.sendText}>{sending ? '\u2026' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

// Short local date + time, e.g. "24/09/2026, 14:05".
function formatTime(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  header:      { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8 },
  topRow:      { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  backText:    { fontFamily: 'DMSans_400Regular', fontSize: 14 },
  pageTitle:   { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: C.text, marginBottom: 4 },
  subtitle:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  threadScroll:{ flex: 1 },
  thread:      { paddingHorizontal: 24, paddingVertical: 12, gap: 10 },
  muted:       { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 24 },
  bubble:      { maxWidth: '82%', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 13 },
  mine:        { alignSelf: 'flex-end' },
  theirs:      { alignSelf: 'flex-start', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  sender:      { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, marginBottom: 3 },
  body:        { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text, lineHeight: 21 },
  composer:    { borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  error:       { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C44B4B', marginBottom: 6 },
  composeRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input:       { flex: 1, maxHeight: 120, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E8DDD8', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#2C2C2C' },
  sendBtn:     { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16 },
  sendText:    { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#FFFFFF' },
});
