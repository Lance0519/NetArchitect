/**
 * Privacy hardening for the Android manifest.
 *
 * `android/` is generated. It is listed in .gitignore and CI regenerates it with
 * `npx expo prebuild --platform android --no-install` on every build, so an
 * edit to android/app/src/main/AndroidManifest.xml is not an edit to this
 * project -- it is an edit to a build artefact that CI never sees and the next
 * prebuild throws away. Everything this plugin changes therefore has to be
 * expressed here, where it is committed, reviewed, and tested.
 *
 * Three controls, and the reasoning behind each:
 *
 * 1. android:allowBackup="false", plus backup rules that exclude every domain.
 *    A saved plan is a network's topology: subnets, gateways, roles, VLAN ids.
 *    With allowBackup=true that data leaves the device through Google's cloud
 *    backup and, on older releases, through `adb backup`, which needs only USB
 *    access. For an app whose entire pitch is "your plans never leave this
 *    device", shipping a one-flag bypass of that promise is the single worst
 *    thing this project could do. The rules files are not redundant with
 *    allowBackup: on Android 12+ allowBackup no longer disables device-to-device
 *    transfer, which is governed by dataExtractionRules alone. Setting all
 *    three means no release depends on a single platform behaviour we cannot
 *    test here -- PLAN.md records that no device pass has ever been performed.
 *
 * 2. android.permission.SYSTEM_ALERT_WINDOW is removed from release. It exists
 *    for React Native's development overlay and has no role in any shipped
 *    feature. A release APK holding it is an overlay-attack surface, and it is
 *    not mentioned in PRIVACY.md.
 *
 * 3. android.permission.INTERNET is removed from release. Every engine in
 *    src/core is pure arithmetic and every feature runs against local SQLite,
 *    so a release build that cannot open a socket is not a release build with
 *    a missing feature. This is what makes PRIVACY.md's "never connects to a
 *    network" enforceable rather than aspirational.
 *
 * Permissions 2 and 3 are stripped with tools:node="remove" rather than by
 * deleting the element. Deleting the element is not enough: expo-file-system
 * declares INTERNET in its own library manifest (verified against the installed
 * copy), and library manifests are merged in at lower priority than the app's.
 * The remove marker is what strips a permission no matter who asked for it.
 *
 * Debug builds keep INTERNET, and must: Metro serves the bundle over a socket,
 * so a debug APK without it cannot connect to the dev server at all. The
 * SYSTEM_ALERT_WINDOW the dev overlay needs is already declared by React
 * Native's own debug variant manifest, and is likewise left alone here.
 */

const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const INTERNET = 'android.permission.INTERNET';
const SYSTEM_ALERT_WINDOW = 'android.permission.SYSTEM_ALERT_WINDOW';

/** Permissions stripped from the release manifest. Debug keeps INTERNET. */
const BLOCKED_IN_RELEASE = [INTERNET, SYSTEM_ALERT_WINDOW];

/** Build variants that talk to the Metro dev server, and so need INTERNET. */
const DEBUG_VARIANTS = ['debug', 'debugOptimized'];

/**
 * Every domain an Android app can be backed up from, so that a domain added to
 * the app later is not backed up by default because someone forgot this list.
 * `root` alone would cover the app today, since all of its state is
 * credential-encrypted; the sub-domains are listed so the file is also a
 * readable statement of what "no backup" means.
 *
 * device_* domains are deliberately omitted. minSdk is 24 and the app keeps all
 * state in credential-encrypted storage, so there is no device-protected
 * storage to exclude, and listing domains the app cannot populate is a claim
 * this project has not verified.
 */
const EXCLUDED_BACKUP_DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];

const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';

const DATA_EXTRACTION_RULES = [
  XML_HEADER,
  '<data-extraction-rules>',
  '    <cloud-backup>',
  ...EXCLUDED_BACKUP_DOMAINS.map((domain) => `        <exclude domain="${domain}" />`),
  '    </cloud-backup>',
  '    <device-transfer>',
  ...EXCLUDED_BACKUP_DOMAINS.map((domain) => `        <exclude domain="${domain}" />`),
  '    </device-transfer>',
  '</data-extraction-rules>',
  '',
].join('\n');

const BACKUP_RULES = [
  XML_HEADER,
  '<full-backup-content>',
  ...EXCLUDED_BACKUP_DOMAINS.map((domain) => `    <exclude domain="${domain}" />`),
  '</full-backup-content>',
  '',
].join('\n');

/**
 * Mark a permission as removed in the app's main manifest.
 *
 * The marker is added even when the app's own manifest never asked for the
 * permission, because the point is to strip it from every lower-priority
 * manifest too, including library manifests.
 */
function blockPermissionInRelease(androidManifest, permission) {
  const usesPermissions = androidManifest.manifest['uses-permission'] ?? [];
  const existing = usesPermissions.find((entry) => entry.$['android:name'] === permission);
  const node = existing ?? { $: { 'android:name': permission } };

  node.$['tools:node'] = 'remove';

  // A template may have injected tools:replace for a permission it expected to
  // keep. A replace marker on a removed element contradicts the remove marker,
  // and the merger resolves that conflict rather than in our favour.
  delete node.$['tools:replace'];

  if (!existing) {
    usesPermissions.push(node);
  }
  androidManifest.manifest['uses-permission'] = usesPermissions;
}

const withBlockedReleasePermissions = (config) =>
  withAndroidManifest(config, (androidManifestConfig) => {
    for (const permission of BLOCKED_IN_RELEASE) {
      blockPermissionInRelease(androidManifestConfig.modResults, permission);
    }

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifestConfig.modResults);
    mainApplication.$['android:allowBackup'] = 'false';
    mainApplication.$['android:fullBackupContent'] = '@xml/backup_rules';
    mainApplication.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';

    return androidManifestConfig;
  });

/** Write a res/xml file, creating the directory if prebuild has not yet made it. */
function writeXmlResource(projectRoot, fileName, contents) {
  const directory = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), contents, 'utf8');
}

/**
 * Restore INTERNET in the debug variants.
 *
 * These are the build types `npm run android`, `npx expo run:android`, and the
 * debug option on the APK workflow all produce. Without INTERNET they cannot
 * reach Metro and fail to load a bundle, so the removal in release has to be
 * undone here or development stops working.
 *
 * The insert is a plain string rather than a re-serialised XML document,
 * because these files are regenerated by every prebuild and the smallest
 * possible edit is the easiest one to keep correct across template changes.
 */
function grantInternetToDebugVariant(projectRoot, variant) {
  const manifestPath = path.join(projectRoot, 'android', 'app', 'src', variant, 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  const source = fs.readFileSync(manifestPath, 'utf8');
  if (source.includes(INTERNET)) {
    return;
  }

  const openingTagEnd = source.indexOf('>', source.indexOf('<manifest'));
  if (openingTagEnd === -1) {
    throw new Error(`with-privacy-hardening: could not find the <manifest> element in ${manifestPath}`);
  }

  const patched =
    source.slice(0, openingTagEnd + 1) +
    `\n\n    <uses-permission android:name="${INTERNET}" />` +
    source.slice(openingTagEnd + 1);

  fs.writeFileSync(manifestPath, patched, 'utf8');
}

const withBackupRules = (config) =>
  withDangerousMod(config, [
    'android',
    async (androidConfig) => {
      writeXmlResource(androidConfig.modRequest.projectRoot, 'data_extraction_rules.xml', DATA_EXTRACTION_RULES);
      writeXmlResource(androidConfig.modRequest.projectRoot, 'backup_rules.xml', BACKUP_RULES);

      for (const variant of DEBUG_VARIANTS) {
        grantInternetToDebugVariant(androidConfig.modRequest.projectRoot, variant);
      }

      return androidConfig;
    },
  ]);

module.exports = function withPrivacyHardening(config) {
  return withBackupRules(withBlockedReleasePermissions(config));
};
