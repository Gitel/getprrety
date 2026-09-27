// Server copy of the app's Skin Era table. KEEP IN SYNC with ERAS in src/constants.js
// (eras.test.js fails if the two drift apart).
//
// Why the server needs it: a SkinAnalysis stores the WHOLE era object (colors, emoji,
// name...), and HomeScreen/ProfileScreen read era.color / era.bg / era.emoji with no
// fallback: an analysis without a complete era crashes both screens. So when an admin
// changes the era, they only pick an id from this list, and the server writes the full
// object from here. Never a half-filled era.
//
// Emoji and the em dash are written as \u escapes to keep this source file ASCII.
const ERAS = {
  barrier_healing:  { id: 'barrier_healing',  emoji: '\u{1F33F}', name: 'Barrier Healing Era',  tagline: 'Your skin is not broken \u2014 it\'s asking for gentleness.', affirmation: 'I give my skin permission to heal at its own pace.', color: '#7A9E6E', bg: '#F2F6EF' },
  acne_reset:       { id: 'acne_reset',       emoji: '\u{1F9CA}', name: 'Acne Reset Era',       tagline: 'Your skin isn\'t struggling \u2014 it\'s communicating.',     affirmation: 'I listen to my skin instead of fighting it.',        color: '#6A98B0', bg: '#EEF4F8' },
  burnout_recovery: { id: 'burnout_recovery', emoji: '\u{1F634}', name: 'Burnout Recovery Era', tagline: 'Your skin is tired because you are. That\'s valid.',          affirmation: 'Rest is part of my skincare routine.',               color: '#9B85B8', bg: '#F5F2F8' },
  glow_building:    { id: 'glow_building',    emoji: '\u2728',    name: 'Glow Building Era',    tagline: 'Your foundation is ready. Now we build radiance.',            affirmation: 'I nourish my skin with intention, not urgency.',     color: '#B8924A', bg: '#FBF6EE' },
  repair_restore:   { id: 'repair_restore',   emoji: '\u{1F319}', name: 'Repair & Restore Era', tagline: 'Aging is not the enemy \u2014 neglect is.',                   affirmation: 'I invest in my skin\'s future, one day at a time.',  color: '#B07860', bg: '#FAF3EF' },
};

// The full era object for an id, or null for anything not in the table.
function eraById(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ERAS, id) ? { ...ERAS[id] } : null;
}

module.exports = { ERAS, eraById };
