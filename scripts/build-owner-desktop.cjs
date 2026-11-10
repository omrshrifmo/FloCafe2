#!/usr/bin/env node
/**
 * FloOwner Control System v4.9.1 - Standalone Desktop Builder
 * Builds native Windows (.exe) and Linux (.AppImage) executables for FloOwner Control System.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const configPath = path.join(rootDir, 'owner-system', 'electron-builder-owner.json');

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

console.log('='.repeat(70));
console.log('🔨 Building Standalone FloOwner Control System Desktop App (v4.9.1)...');
console.log('='.repeat(70));

const builderCmd = 'npx electron-builder --config owner-system/electron-builder-owner.json --win nsis --linux AppImage';

try {
  console.log(`Running: ${builderCmd}`);
  execSync(builderCmd, {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES: 'true',
    },
  });

  // Verify and normalize outputs
  const expectedWin = path.join(releaseDir, 'FloOwner-Control-4.9.1-win-x64.exe');
  const expectedLinux = path.join(releaseDir, 'FloOwner-Control-4.9.1-linux-x86_64.AppImage');

  // Check if builder produced slightly differently named files and align them
  const files = fs.readdirSync(releaseDir);
  for (const f of files) {
    if (f.startsWith('FloOwner-Control') && f.endsWith('.AppImage') && f !== 'FloOwner-Control-4.9.1-linux-x86_64.AppImage') {
      const src = path.join(releaseDir, f);
      fs.copyFileSync(src, expectedLinux);
      console.log(`[Owner Builder] Normalized Linux AppImage to: ${expectedLinux}`);
    }
    if (f.startsWith('FloOwner-Control') && f.endsWith('.exe') && f !== 'FloOwner-Control-4.9.1-win-x64.exe') {
      const src = path.join(releaseDir, f);
      fs.copyFileSync(src, expectedWin);
      console.log(`[Owner Builder] Normalized Windows installer to: ${expectedWin}`);
    }
  }

  console.log('\n✅ FloOwner Control Desktop build completed successfully:');
  if (fs.existsSync(expectedWin)) console.log(`   - Windows: ${expectedWin} (${fs.statSync(expectedWin).size} bytes)`);
  if (fs.existsSync(expectedLinux)) console.log(`   - Linux:   ${expectedLinux} (${fs.statSync(expectedLinux).size} bytes)`);
} catch (err) {
  console.error('\n❌ FloOwner Control Desktop build failed:', err.message);
  process.exit(1);
}
