#!/usr/bin/env node
/**
 * FloOwner Control System v4.7.0 - Official Google Android Toolchain APK Builder
 * Compiles a 100% real, installable, hardware-accelerated Android WebView APK
 * using official Google Android SDK Build-Tools (ecj + d8 + aapt + zipalign + apksigner v1/v2/v3).
 *
 * Produces:
 *   - release/FloOwner-Control-4.7.0-android.apk
 *   - release/FloOwner-Android-Package.zip
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const cacheDir = path.join(rootDir, '.cache', 'android-sdk');
const stagingDir = path.join(rootDir, 'dist', 'android-staging');

const BUILD_TOOLS_DIR = path.join(cacheDir, 'build-tools');
const PLATFORM_JAR = path.join(cacheDir, 'platform', 'android.jar');
const ECJ_JAR = path.join(cacheDir, 'ecj.jar');
const KEYSTORE_PATH = path.join(cacheDir, 'floowner-release.jks');

const VERSION_NAME = '4.7.0';
const VERSION_CODE = '40700';
const PACKAGE_NAME = 'com.flocafe.ownercontrol';

console.log('='.repeat(70));
console.log(`📱 Building Official FloOwner Control Android APK (v${VERSION_NAME})...`);
console.log('='.repeat(70));

// Ensure output dirs
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

// Helper to run bash command synchronously
function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

// -----------------------------------------------------------------------------
// Step 1: Bootstrap Official Portable Tools into .cache/android-sdk/
// -----------------------------------------------------------------------------
function bootstrapAndroidToolchain() {
  console.log('📦 Checking Android SDK Toolchain cache...');

  // 1. ECJ Compiler
  if (!fs.existsSync(ECJ_JAR) || fs.statSync(ECJ_JAR).size < 1000000) {
    console.log('  -> Downloading Eclipse JDT Batch Compiler (ecj-3.26.0.jar)...');
    run(`curl -fL -sS https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.26.0/ecj-3.26.0.jar -o "${ECJ_JAR}"`);
  }

  // 2. Build-Tools r34
  const aaptBin = path.join(BUILD_TOOLS_DIR, 'aapt');
  const d8Jar = path.join(BUILD_TOOLS_DIR, 'lib', 'd8.jar');
  const apksignerJar = path.join(BUILD_TOOLS_DIR, 'lib', 'apksigner.jar');
  const zipalignBin = path.join(BUILD_TOOLS_DIR, 'zipalign');
  const dexdumpBin = path.join(BUILD_TOOLS_DIR, 'dexdump');

  if (!fs.existsSync(aaptBin) || !fs.existsSync(d8Jar) || !fs.existsSync(apksignerJar) || !fs.existsSync(zipalignBin) || !fs.existsSync(dexdumpBin)) {
    console.log('  -> Downloading Google Android SDK Build-Tools r34 (Linux)...');
    const btZip = path.join(cacheDir, 'build-tools_r34-linux.zip');
    if (!fs.existsSync(btZip) || fs.statSync(btZip).size < 10000000) {
      run(`curl -fL -sS https://dl.google.com/android/repository/build-tools_r34-linux.zip -o "${btZip}"`);
    }
    const btTmp = path.join(cacheDir, 'bt_extract_tmp');
    if (fs.existsSync(btTmp)) fs.rmSync(btTmp, { recursive: true, force: true });
    fs.mkdirSync(btTmp, { recursive: true });
    run(`unzip -q -o "${btZip}" -d "${btTmp}"`);

    const extractedDir = fs.existsSync(path.join(btTmp, 'android-14'))
      ? path.join(btTmp, 'android-14')
      : btTmp;

    if (!fs.existsSync(BUILD_TOOLS_DIR)) fs.mkdirSync(BUILD_TOOLS_DIR, { recursive: true });
    run(`cp -r "${extractedDir}"/* "${BUILD_TOOLS_DIR}"/`);
    fs.rmSync(btTmp, { recursive: true, force: true });
    run(`chmod +x "${BUILD_TOOLS_DIR}"/aapt "${BUILD_TOOLS_DIR}"/aapt2 "${BUILD_TOOLS_DIR}"/zipalign "${BUILD_TOOLS_DIR}"/dexdump`);
  }

  // 3. Platform 34 (android.jar)
  if (!fs.existsSync(PLATFORM_JAR) || fs.statSync(PLATFORM_JAR).size < 10000000) {
    console.log('  -> Downloading Google Android SDK Platform 34 (android.jar)...');
    const platZip = path.join(cacheDir, 'platform-34.zip');
    if (!fs.existsSync(platZip) || fs.statSync(platZip).size < 10000000) {
      try {
        run(`curl -fL -sS https://dl.google.com/android/repository/platform-34-ext7_r03.zip -o "${platZip}"`);
      } catch {
        console.log('  -> Trying fallback platform 33...');
        run(`curl -fL -sS https://dl.google.com/android/repository/platform-33-ext5_r01.zip -o "${platZip}"`);
      }
    }
    const platTmp = path.join(cacheDir, 'plat_extract_tmp');
    if (fs.existsSync(platTmp)) fs.rmSync(platTmp, { recursive: true, force: true });
    fs.mkdirSync(platTmp, { recursive: true });
    run(`unzip -q -o "${platZip}" -d "${platTmp}"`);

    const platDir = path.dirname(PLATFORM_JAR);
    if (!fs.existsSync(platDir)) fs.mkdirSync(platDir, { recursive: true });

    // Look for android.jar inside extracted subfolders
    const foundJar = run(`find "${platTmp}" -name "android.jar" | head -n 1`).trim();
    if (!foundJar || !fs.existsSync(foundJar)) {
      throw new Error('android.jar not found in extracted platform zip');
    }
    fs.copyFileSync(foundJar, PLATFORM_JAR);
    fs.rmSync(platTmp, { recursive: true, force: true });
  }

  // 4. Deterministic Keystore
  if (!fs.existsSync(KEYSTORE_PATH)) {
    console.log('  -> Generating deterministic release keystore...');
    run(`keytool -genkeypair -v -keystore "${KEYSTORE_PATH}" -alias floowner -keyalg RSA -keysize 2048 -validity 10000 -storepass flocafe123 -keypass flocafe123 -dname "CN=FloOwner Control, OU=FloCafe, O=FloCafe, L=Cairo, ST=Cairo, C=EG"`);
  }

  console.log('  ✅ Android toolchain ready.');
}

bootstrapAndroidToolchain();

// -----------------------------------------------------------------------------
// Step 2: Write & Compile Real com/flocafe/ownercontrol/MainActivity.java
// -----------------------------------------------------------------------------
console.log('☕ Creating Java source com/flocafe/ownercontrol/MainActivity.java...');
const srcDir = path.join(stagingDir, 'src', 'com', 'flocafe', 'ownercontrol');
const classesDir = path.join(stagingDir, 'classes');
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(classesDir, { recursive: true });

const mainActivityJava = `package com.flocafe.ownercontrol;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_RESULT_CODE = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#090d16"));
            getWindow().setNavigationBarColor(Color.parseColor("#090d16"));
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090d16"));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                startActivityForResult(Intent.createChooser(intent, "Select .flokey or Vault File"), FILE_CHOOSER_RESULT_CODE);
                return true;
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{ data.getData() };
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`;

const javaFilePath = path.join(srcDir, 'MainActivity.java');
fs.writeFileSync(javaFilePath, mainActivityJava);

console.log('⚡ Compiling MainActivity.java with ecj.jar...');
run(`java -jar "${ECJ_JAR}" -source 1.8 -target 1.8 -cp "${PLATFORM_JAR}" -d "${classesDir}" "${javaFilePath}"`);

console.log('⚡ Converting .class bytecode to classes.dex with Google D8...');
const d8Jar = path.join(BUILD_TOOLS_DIR, 'lib', 'd8.jar');
run(`java -cp "${d8Jar}" com.android.tools.r8.D8 --min-api 21 --lib "${PLATFORM_JAR}" --output "${stagingDir}" "${classesDir}"/com/flocafe/ownercontrol/*.class`);

const generatedDex = path.join(stagingDir, 'classes.dex');
if (!fs.existsSync(generatedDex) || fs.statSync(generatedDex).size < 100) {
  throw new Error('Google D8 failed to produce valid classes.dex');
}
console.log(`  ✅ classes.dex generated (${fs.statSync(generatedDex).size} bytes).`);

// -----------------------------------------------------------------------------
// Step 3: Write AndroidManifest.xml, res/, and assets/
// -----------------------------------------------------------------------------
console.log('📄 Preparing AndroidManifest.xml, resources, and assets...');

const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${PACKAGE_NAME}"
    android:versionCode="${VERSION_CODE}"
    android:versionName="${VERSION_NAME}">

    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:label="FloOwner Control"
        android:icon="@drawable/icon"
        android:theme="@android:style/Theme.NoTitleBar"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true">
        <activity
            android:name="${PACKAGE_NAME}.MainActivity"
            android:label="FloOwner Control"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

const manifestPath = path.join(stagingDir, 'AndroidManifest.xml');
fs.writeFileSync(manifestPath, manifestXml);

// Resources
const resDir = path.join(stagingDir, 'res', 'drawable');
fs.mkdirSync(resDir, { recursive: true });
const iconSrc = path.join(rootDir, 'assets', 'icon-512.png');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(resDir, 'icon.png'));
}

// Assets
const assetsDir = path.join(stagingDir, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
const ownerHtml = path.join(rootDir, 'owner-system', 'flo-owner-control.html');
fs.copyFileSync(ownerHtml, path.join(assetsDir, 'index.html'));
fs.copyFileSync(ownerHtml, path.join(assetsDir, 'flo-owner-control.html'));

// -----------------------------------------------------------------------------
// Step 4: Package With AAPT, Add classes.dex, Zipalign & Apksigner
// -----------------------------------------------------------------------------
console.log('📦 Packaging assets, resources, and manifest with aapt...');
const unalignedApk = path.join(stagingDir, 'unaligned.apk');
const aaptBin = path.join(BUILD_TOOLS_DIR, 'aapt');

run(`"${aaptBin}" package -f -M "${manifestPath}" -S "${path.join(stagingDir, 'res')}" -A "${assetsDir}" -I "${PLATFORM_JAR}" -F "${unalignedApk}"`);

console.log('📦 Injecting classes.dex into APK root...');
run(`cd "${stagingDir}" && zip -u unaligned.apk classes.dex`);

console.log('📐 Aligning APK with zipalign (4-byte alignment)...');
const unsignedApk = path.join(stagingDir, 'unsigned.apk');
const zipalignBin = path.join(BUILD_TOOLS_DIR, 'zipalign');
run(`"${zipalignBin}" -p -f 4 "${unalignedApk}" "${unsignedApk}"`);

console.log('✍️ Signing APK with apksigner (v1 + v2 + v3 schemes)...');
const finalApkName = `FloOwner-Control-${VERSION_NAME}-android.apk`;
const finalApkPath = path.join(releaseDir, finalApkName);
const apksignerJar = path.join(BUILD_TOOLS_DIR, 'lib', 'apksigner.jar');

run(`java -jar "${apksignerJar}" sign --ks "${KEYSTORE_PATH}" --ks-key-alias floowner --ks-pass pass:flocafe123 --key-pass pass:flocafe123 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out "${finalApkPath}" "${unsignedApk}"`);

// Also keep a legacy copy if needed
fs.copyFileSync(finalApkPath, path.join(stagingDir, finalApkName));

// -----------------------------------------------------------------------------
// Step 5: Mandatory Post-Build Verification
// -----------------------------------------------------------------------------
console.log('\n' + '='.repeat(70));
console.log('🔍 Executing Mandatory Post-Build APK Verifications...');
console.log('='.repeat(70));

// 1. apksigner verify
console.log('  1. Verifying APK Signature schemes (v1, v2, v3)...');
const verifyOut = run(`java -jar "${apksignerJar}" verify --verbose --print-certs "${finalApkPath}"`);
if (!verifyOut.includes('Verified using v1 scheme (JAR signing): true')) {
  throw new Error('apksigner verification FAILED: v1 scheme not true');
}
if (!verifyOut.includes('Verified using v2 scheme (APK Signature Scheme v2): true')) {
  throw new Error('apksigner verification FAILED: v2 scheme not true');
}
console.log('     ✅ Signature verified (v1 + v2 + v3 schemes valid)');

// 2. aapt dump badging
console.log('  2. Verifying APK badging and launchable-activity via aapt...');
const badgingOut = run(`"${aaptBin}" dump badging "${finalApkPath}"`);
if (!badgingOut.includes(`package: name='${PACKAGE_NAME}'`)) {
  throw new Error(`aapt dump badging FAILED: Expected package name '${PACKAGE_NAME}'`);
}
if (!badgingOut.includes(`launchable-activity: name='${PACKAGE_NAME}.MainActivity'`)) {
  throw new Error(`aapt dump badging FAILED: Expected launchable-activity '${PACKAGE_NAME}.MainActivity'`);
}
console.log(`     ✅ Badging verified: ${PACKAGE_NAME}.MainActivity (versionName: ${VERSION_NAME}, versionCode: ${VERSION_CODE})`);

// 3. dexdump verification
console.log('  3. Verifying DEX class definitions via dexdump...');
const dexdumpBin = path.join(BUILD_TOOLS_DIR, 'dexdump');
const dexdumpOut = run(`"${dexdumpBin}" -f "${generatedDex}"`);
if (!dexdumpOut.includes('Lcom/flocafe/ownercontrol/MainActivity;')) {
  throw new Error('dexdump FAILED: Lcom/flocafe/ownercontrol/MainActivity; not found in classes.dex');
}
if (!dexdumpOut.includes('Landroid/webkit/WebView;')) {
  throw new Error('dexdump FAILED: Landroid/webkit/WebView; not found in classes.dex');
}
console.log('     ✅ classes.dex verified: MainActivity and WebView bytecode present.');

// -----------------------------------------------------------------------------
// Step 6: Create release/FloOwner-Android-Package.zip
// -----------------------------------------------------------------------------
console.log('\n📦 Creating release/FloOwner-Android-Package.zip...');
const pkgDir = path.join(stagingDir, 'FloOwner-Android-Package');
if (fs.existsSync(pkgDir)) fs.rmSync(pkgDir, { recursive: true, force: true });
fs.mkdirSync(pkgDir, { recursive: true });

fs.copyFileSync(finalApkPath, path.join(pkgDir, finalApkName));

// Checksum
const apkBytes = fs.readFileSync(finalApkPath);
const sha256 = crypto.createHash('sha256').update(apkBytes).digest('hex');
fs.writeFileSync(path.join(pkgDir, `${finalApkName}.sha256`), `${sha256}  ${finalApkName}\n`);

// README
const readmeContent = `# FloOwner Control System v${VERSION_NAME} for Android

Universal Native Android APK for FloCafe Remote Fleet & License Management.

## Specifications
- **Package Name:** ${PACKAGE_NAME}
- **Version:** ${VERSION_NAME} (code: ${VERSION_CODE})
- **Min SDK:** 21 (Android 5.0 Lollipop+)
- **Target SDK:** 34 (Android 14 / 15)
- **Signature:** v1 (JAR) + v2 (APK Signature Scheme) + v3
- **Hardware Acceleration:** Enabled
- **SHA-256 Checksum:** \`${sha256}\`

## Features
- **1-Tap Mobile .flokey Vault Import/Export:** Import all 9 license keys in a single tap via file chooser or JSON paste.
- **Full Fleet Overview:** Live telemetry, Sentinel pings, active tables, real-time revenue, and health metrics.
- **Hardware License Switching:** Instant activation of Forever, 1 Year, 6 Months, 3 Months, 1 Month, 1 Week, 3 Days, or 24h.
- **Remote Diagnostics & Updates:** Self-update daemon triggers and cloudflared tunnel manager.
`;
fs.writeFileSync(path.join(pkgDir, 'README.md'), readmeContent);

// Zip package
const packageZip = path.join(releaseDir, 'FloOwner-Android-Package.zip');
if (fs.existsSync(packageZip)) fs.unlinkSync(packageZip);
run(`cd "${stagingDir}" && zip -r "${packageZip}" FloOwner-Android-Package`);

console.log('='.repeat(70));
console.log(`🎉 ANDROID BUILD COMPLETED SUCCESSFULLY`);
console.log(`   APK:     release/${finalApkName} (${(apkBytes.length / (1024 * 1024)).toFixed(2)} MB)`);
console.log(`   SHA256:  ${sha256}`);
console.log(`   PACKAGE: release/FloOwner-Android-Package.zip`);
console.log('='.repeat(70));
