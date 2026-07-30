// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // `scripts/cmd-guard/vendor` holds third-party code we don't reformat.
    ignores: ['dist/*', 'scripts/cmd-guard/vendor/*'],
  },
]);
