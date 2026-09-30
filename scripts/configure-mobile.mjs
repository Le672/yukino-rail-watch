import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliRequire = createRequire(import.meta.resolve('@capacitor/cli/package.json'));
const plist = cliRequire('plist');
const version = JSON.parse(fs.readFileSync(path.join(root, 'mobile-version.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version.version) || !Number.isInteger(version.build) || version.build < 1 || version.appId !== 'bond.yukino.rail') throw new Error('Invalid mobile-version.json');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text); };

let manifest = read('android/app/src/main/AndroidManifest.xml').replace('android:allowBackup="true"', 'android:allowBackup="false"');
if (!manifest.includes('android:usesCleartextTraffic=')) manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"');
for (const permission of ['POST_NOTIFICATIONS', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION']) {
  if (!manifest.includes(`android.permission.${permission}`)) manifest = manifest.replace('</manifest>', `    <uses-permission android:name="android.permission.${permission}" />\n</manifest>`);
}
if (!manifest.includes('android.hardware.location.gps')) manifest = manifest.replace('</manifest>', '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>');
write('android/app/src/main/AndroidManifest.xml', manifest);

let gradle = read('android/app/build.gradle').replace(/versionCode \d+/, `versionCode ${version.build}`).replace(/versionName "[^"]+"/, `versionName "${version.version}"`);
if (!gradle.includes('androidx.work:work-runtime')) gradle = gradle.replace('dependencies {', 'dependencies {\n    implementation "androidx.work:work-runtime:2.10.5"');
if (!gradle.includes('// Rail release signing')) gradle = gradle.replace("apply from: 'capacitor.build.gradle'", `// Rail release signing: keep the keystore and passwords outside source control.
def railSigningNames = ['RAIL_ANDROID_KEYSTORE_PATH', 'RAIL_ANDROID_STORE_PASSWORD', 'RAIL_ANDROID_KEY_ALIAS', 'RAIL_ANDROID_KEY_PASSWORD']
def railSigningValues = railSigningNames.collect { System.getenv(it) }
if (railSigningValues.any { it } && !railSigningValues.every { it }) {
    throw new GradleException('All four RAIL_ANDROID signing environment variables must be set together')
}
if (railSigningValues.every { it }) {
    android.signingConfigs.create('railRelease') {
        storeFile file(railSigningValues[0])
        storePassword railSigningValues[1]
        keyAlias railSigningValues[2]
        keyPassword railSigningValues[3]
    }
    android.buildTypes.release.signingConfig = android.signingConfigs.railRelease
}

apply from: 'capacitor.build.gradle'`);
write('android/app/build.gradle', gradle);
write('android/app/src/main/res/drawable/ic_stat_rail.xml', `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="@android:color/transparent" android:strokeColor="#FFFFFFFF" android:strokeWidth="1.5" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="M8,3.1V7a4,4 0,0 0,8 0V3.1 M9,15l-1,-1 M15,15l1,-1 M9,19c-2.8,0 -5,-2.2 -5,-5v-4a8,8 0,0 1,16 0v4c0,2.8 -2.2,5 -5,5Z M8,19l-2,3 M16,19l2,3" />
</vector>
`);
write('android/app/src/main/res/values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#f3f6f4</color></resources>\n`);
write('android/app/src/main/res/values/colors.xml', `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="colorPrimary">#315c42</color><color name="colorPrimaryDark">#244832</color><color name="colorAccent">#315c42</color></resources>\n`);
let styles = read('android/app/src/main/res/values/styles.xml').replace('<item name="android:background">@drawable/splash</item>', '<item name="windowSplashScreenBackground">#f3f6f4</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
write('android/app/src/main/res/values/styles.xml', styles);

const info = plist.parse(read('ios/App/App/Info.plist'));
Object.assign(info, {
  CFBundleDevelopmentRegion: 'zh_CN',
  NSLocationWhenInUseUsageDescription: '开启 GPS 后读取当前位置，用于判断所选列车的下一站和实时速度；位置仅在本机处理，后台停止读取。',
  NSLocationAlwaysAndWhenInUseUsageDescription: '仅在使用位置页面并开启 GPS 时读取位置；本应用不请求后台定位，不上传位置历史。',
  UIBackgroundModes: ['fetch'],
  BGTaskSchedulerPermittedIdentifiers: ['bond.yukino.rail.refresh'],
  ITSAppUsesNonExemptEncryption: false,
});
write('ios/App/App/Info.plist', plist.build(info) + '\n');
// Native UserDefaults is used only for this app's settings, cached results and notification deduplication.
write('ios/App/App/PrivacyInfo.xcprivacy', plist.build({
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyCollectedDataTypes: [],
  NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] }],
}) + '\n');
let pbx = read('ios/App/App.xcodeproj/project.pbxproj').replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version.version};`).replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${version.build};`);
// Stable IDs make repeated syncs produce the same project without duplicating resources.
if (!pbx.includes('PrivacyInfo.xcprivacy')) {
  pbx = pbx.replace('/* Begin PBXBuildFile section */', '/* Begin PBXBuildFile section */\n\t\tA10000000000000000000001 /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = A10000000000000000000002 /* PrivacyInfo.xcprivacy */; };');
  pbx = pbx.replace('/* Begin PBXFileReference section */', '/* Begin PBXFileReference section */\n\t\tA10000000000000000000002 /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };');
  pbx = pbx.replace(/(504EC3061FED79650016851F \/\* App \*\/ = \{\s*isa = PBXGroup;\s*children = \()/, '$1\n\t\t\t\tA10000000000000000000002 /* PrivacyInfo.xcprivacy */,');
  pbx = pbx.replace(/(504EC3021FED79650016851F \/\* Resources \*\/ = \{\s*isa = PBXResourcesBuildPhase;\s*buildActionMask = 2147483647;\s*files = \()/, '$1\n\t\t\t\tA10000000000000000000001 /* PrivacyInfo.xcprivacy in Resources */,');
}
write('ios/App/App.xcodeproj/project.pbxproj', pbx);
write('ios/App/App/Base.lproj/Main.storyboard', read('ios/App/App/Base.lproj/Main.storyboard').replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="RailBridgeViewController" customModule="App"'));
console.log(`Mobile native configuration: ${version.appId} ${version.version} (${version.build})`);
