import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { C } from '../constants';
import { api } from '../lib/api';

const EMPTY_METADATA = { country: null, lat: null, lng: null, timezone: null };

export default function LocationQuestion({ value = {}, onChange }) {
  const [query, setQuery] = useState(value.city || '');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const selectedCity = useRef(value.country ? value.city : null);

  useEffect(() => {
    if ((value.city || '') !== query) setQuery(value.city || '');
  }, [value.city]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || selectedCity.current === query) {
      setSuggestions([]);
      setLoading(false);
      setSearched(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setSearched(false);
      try {
        const results = await api.get(`/api/cities/autocomplete?q=${encodeURIComponent(trimmed)}`);
        if (active) setSuggestions(Array.isArray(results) ? results.slice(0, 10) : []);
      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) {
          setLoading(false);
          setSearched(true);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  function handleTextChange(text) {
    selectedCity.current = null;
    setQuery(text);
    setSuggestions([]);
    setSearched(false);
    onChange({ city: text, ...EMPTY_METADATA });
  }

  function selectCity(city) {
    selectedCity.current = city.city;
    setQuery(city.city);
    setSuggestions([]);
    setSearched(false);
    onChange(city);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholder="Start typing your city"
          placeholderTextColor={C.muted}
          autoCapitalize="words"
          autoCorrect={false}
          value={query}
          onChangeText={handleTextChange}
          accessibilityLabel="City"
        />
        {loading && <ActivityIndicator style={styles.spinner} size="small" color={C.accent} />}
      </View>

      {suggestions.length > 0 && (
        <View style={styles.list} accessibilityRole="menu">
          {suggestions.map((city, index) => (
            <Pressable
              key={`${city.city}-${city.country}-${city.lat}-${city.lng}`}
              onPress={() => selectCity(city)}
              accessibilityRole="menuitem"
              style={({ pressed }) => [
                styles.suggestion,
                index < suggestions.length - 1 && styles.suggestionBorder,
                pressed && styles.suggestionPressed,
              ]}
            >
              <Text style={styles.city}>{city.city}</Text>
              <Text style={styles.country}>{city.country}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {value.country && selectedCity.current === query && (
        <Text style={styles.selected}>Selected: {value.city}, {value.country}</Text>
      )}
      {!loading && searched && suggestions.length === 0 && query.trim().length >= 2 && (
        <Text style={styles.noResults}>No match found — you can still continue with this city.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  inputWrap: { position: 'relative' },
  input: {
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13,
    padding: 14, paddingRight: 46, fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.text,
  },
  spinner: { position: 'absolute', right: 14, top: 15 },
  list: {
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13,
    marginTop: 6, overflow: 'hidden',
  },
  suggestion: {
    minHeight: 46, paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  suggestionBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  suggestionPressed: { backgroundColor: C.accentLight },
  city: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text },
  country: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: C.muted, letterSpacing: 0.8 },
  selected: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#7A9E6E', marginTop: 7 },
  noResults: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, marginTop: 7, lineHeight: 16 },
});
