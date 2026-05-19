import { useState } from "react";
import { supabase } from "../lib/supabase";

const C = {
  bg: "#FAF7F4",
  text: "#2C2C2C",
  muted: "#9B8E85",
  border: "#E8DDD8",
  accent: "#C9897A",
  accentLight: "#FBF6EE",
};

const OPTIONS = [
  { value: "morning", emoji: "🌅", label: "Morning person" },
  { value: "night",   emoji: "🌙", label: "Night owl" },
  { value: "both",    emoji: "✨", label: "Both" },
];

export default function SkinTimingScreen({ userId, onDone }) {
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleContinue() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      if (userId) {
        const { error: dbErr } = await supabase
          .from("profiles")
          .update({ skincare_timing: selected })
          .eq("id", userId);
        if (dbErr) throw dbErr;
      }
      onDone();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      height: "100%",
      background: C.bg,
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
    }}>
      <div style={{ flex: 1, padding: "40px 24px 40px", display: "flex", flexDirection: "column" }}>

        {/* Headline */}
        <div style={{ marginBottom: 36 }}>
          <p style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 26,
            fontWeight: 500,
            color: C.text,
            lineHeight: 1.4,
            margin: "0 0 6px",
          }}>
            One last thing —
          </p>
          <p style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 15,
            color: C.muted,
            lineHeight: 1.65,
            margin: 0,
          }}>
            when do you usually do your skincare?
          </p>
        </div>

        {/* Option cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
          {OPTIONS.map(opt => {
            const isSelected = selected === opt.value;
            return (
              <TimingCard
                key={opt.value}
                emoji={opt.emoji}
                label={opt.label}
                selected={isSelected}
                onSelect={() => setSelected(opt.value)}
              />
            );
          })}

          {error && (
            <p style={{
              fontSize: 12,
              color: C.accent,
              textAlign: "center",
              fontFamily: "'DM Sans', system-ui, sans-serif",
              margin: "4px 0",
            }}>
              {error}
            </p>
          )}

          <div style={{ flex: 1 }} />

          {/* CTA */}
          <button
            onClick={handleContinue}
            disabled={!selected || loading}
            style={{
              width: "100%",
              padding: "15px 0",
              borderRadius: 13,
              border: "none",
              background: (!selected || loading) ? "#D4C5BF" : C.accent,
              color: C.bg,
              fontSize: 15,
              fontWeight: 500,
              fontFamily: "'DM Sans', system-ui, sans-serif",
              letterSpacing: 0.4,
              cursor: (!selected || loading) ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {loading ? "Saving..." : "Let's go →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TimingCard({ emoji, label, selected, onSelect }) {
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={onSelect}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        width: "100%",
        padding: "20px 16px",
        borderRadius: 16,
        border: `1.5px solid ${selected ? C.accent : C.border}`,
        background: selected ? C.accent : "#FFFFFF",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        transform: pressed ? "scale(0.97)" : "scale(1)",
        transition: "transform 0.1s, background 0.15s, border-color 0.15s",
        outline: "none",
      }}
    >
      <span style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</span>
      <span style={{
        fontSize: 14,
        fontWeight: 500,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        color: selected ? C.bg : C.text,
        transition: "color 0.15s",
      }}>
        {label}
      </span>
    </button>
  );
}
