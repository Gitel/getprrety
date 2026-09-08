// Stand-in for the `expo/virtual/env` module. babel-preset-expo rewrites every
// `process.env.EXPO_PUBLIC_*` read into an import from that virtual module, but it
// only exists inside a Metro bundle — Node's test environment never produces one, and
// the real file's bare `export` also isn't transformed since it lives in node_modules.
module.exports = { env: process.env };
