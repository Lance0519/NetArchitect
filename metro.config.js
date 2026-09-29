/*
 * Metro configuration.
 *
 * `withNativeWind` injects the CSS compiler into the default Expo config. It
 * must wrap `getDefaultConfig(__dirname)` rather than replace it, because
 * getDefaultConfig is what knows about Expo's asset extensions, the Expo Router
 * source tree and the monorepo resolver rules.
 *
 * The `input` is the global stylesheet. This is also why `global.css` has to
 * exist and be imported somewhere reachable from `app/` - without that import
 * Metro never compiles the file and every `className` silently does nothing,
 * with no error anywhere. See app/_layout.tsx.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
