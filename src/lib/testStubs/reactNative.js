// Minimal react-native stand-in for Node-side unit tests of pure src/lib modules.
// Only the surface those modules actually touch — they must never need a renderer.
module.exports = {
  Alert: { alert: () => {} },
  Linking: { openURL: () => Promise.resolve() },
};
