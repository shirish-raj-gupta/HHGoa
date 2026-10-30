// Expo's defaults already handle this pnpm workspace: Metro watches the repo root and resolves the shared
// TypeScript packages (@receipts/client, @receipts/core) from source.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
