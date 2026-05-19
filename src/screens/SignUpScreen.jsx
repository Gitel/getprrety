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

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function SignUpScreen({ era, onSuccess }) {
  const [firstName, setFirstName] = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [errors,    setErrors]    = useState({});

  function validate() {
    const e = {};
    if (!firstName.trim())          e.firstName = "First name is required.";
    if (!email.trim())              e.email = "Email is required.";
    else if (!isValidEmail(email))  e.email = "Enter a valid email address.";
    if (!password)                  e.password = "Password is required.";
    else if (password.length < 8)   e.password = "Password must be at least 8 characters.";
    return e;
  }

  async function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      const userId = data.user?.id;
      if (userId) {
        await supabase.from("profiles").upsert({
          id: userId,
          first_name: firstName.trim(),
          skin_era: era?.id || null,
        });
      }
      onSuccess(data.user);
    } catch (err) {
      setErrors({ submit: err.message || "Sign up failed. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  const eraName = era?.name || "Your Era";

  return (
    <div style={{
      height: "100%",
      background: C.bg,
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
    }}>
      <div style={{ flex: 1, padding: "36px 24px 40px", display: "flex", flexDirection: "column" }}>

        {/* Era headline */}
        <div style={{ marginBottom: 36 }}>
          <p style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 26,
            fontWeight: 500,
            color: C.text,
            lineHeight: 1.4,
            margin: "0 0 10px",
          }}>
            Your <span style={{ color: C.accent }}>{eraName}</span> routine is ready.
          </p>
          <p style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: 14,
            color: C.muted,
            lineHeight: 1.65,
            margin: 0,
          }}>
            Create your account to unlock it — and track your skin journey.
          </p>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>

          {/* First Name */}
          <div>
            <input
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={e => { setFirstName(e.target.value); setErrors(v => ({...v, firstName: undefined})); }}
              style={inputStyle(!!errors.firstName)}
            />
            {errors.firstName && <p style={errorStyle}>{errors.firstName}</p>}
          </div>

          {/* Email */}
          <div>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => { setEmail(e.target.value); setErrors(v => ({...v, email: undefined})); }}
              style={inputStyle(!!errors.email)}
            />
            {errors.email && <p style={errorStyle}>{errors.email}</p>}
          </div>

          {/* Password */}
          <div>
            <div style={{ position: "relative" }}>
              <input
                type={showPw ? "text" : "password"}
                placeholder="Password (min. 8 characters)"
                value={password}
                onChange={e => { setPassword(e.target.value); setErrors(v => ({...v, password: undefined})); }}
                style={{ ...inputStyle(!!errors.password), paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                style={{
                  position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 16, color: C.muted, padding: 0, lineHeight: 1,
                }}
              >
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
            {errors.password && <p style={errorStyle}>{errors.password}</p>}
          </div>

          {errors.submit && (
            <p style={{ ...errorStyle, textAlign: "center", marginTop: 4 }}>{errors.submit}</p>
          )}

          <div style={{ flex: 1 }} />

          {/* CTA */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: "100%",
              padding: "15px 0",
              borderRadius: 13,
              border: "none",
              background: loading ? "#D4C5BF" : C.accent,
              color: C.bg,
              fontSize: 15,
              fontWeight: 500,
              fontFamily: "'DM Sans', system-ui, sans-serif",
              letterSpacing: 0.4,
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "background 0.2s",
            }}
          >
            {loading ? <Spinner /> : "Enter my Era →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function inputStyle(hasError) {
  return {
    width: "100%",
    padding: "13px 14px",
    borderRadius: 12,
    border: `1.5px solid ${hasError ? "#C9897A" : "#E8DDD8"}`,
    background: "#FFFFFF",
    fontSize: 14,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    color: "#2C2C2C",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };
}

const errorStyle = {
  fontSize: 12,
  color: "#C9897A",
  margin: "5px 0 0 4px",
  fontFamily: "'DM Sans', system-ui, sans-serif",
};

function Spinner() {
  return (
    <span style={{
      width: 16, height: 16,
      border: "2px solid rgba(250,247,244,0.4)",
      borderTopColor: "#FAF7F4",
      borderRadius: "50%",
      display: "inline-block",
      animation: "spin 0.7s linear infinite",
    }}/>
  );
}
