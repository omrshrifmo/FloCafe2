#!/usr/bin/env node
'use strict';

/**
 * launch-owner-control.cjs
 * Opens owner-system/flo-owner-control.html in the default browser.
 * Works on Windows, Linux (xdg-open), and macOS.
 */

const path = require('path');
const { exec, execSync } = require('child_process');
const fs = require('fs');

const htmlFile = path.resolve(__dirname, '..', 'owner-system', 'flo-owner-control.html');

if (!fs.existsSync(htmlFile)) {
  console.error('❌  owner-system/flo-owner-control.html not found at:', htmlFile);
  process.exit(1);
}

const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');

console.log('FloOwner Control System v4.3.0');
console.log('Opening:', fileUrl);

const platform = process.platform;
let cmd;

if (platform === 'win32') {
  cmd = `start "" "${htmlFile}"`;
} else if (platform === 'darwin') {
  cmd = `open "${htmlFile}"`;
} else {
  // Linux — try xdg-open, then sensible-browser, then chromium, then firefox
  const browsers = ['xdg-open', 'sensible-browser', 'chromium', 'chromium-browser', 'google-chrome', 'firefox'];
  let opened = false;
  for (const b of browsers) {
    try {
      execSync(`which ${b}`, { stdio: 'ignore' });
      cmd = `${b} "${htmlFile}" &`;
      opened = true;
      break;
    } catch {}
  }
  if (!opened) {
    console.log('No browser launcher found. Open this URL manually:');
    console.log(fileUrl);
    process.exit(0);
  }
}

exec(cmd, (err) => {
  if (err) {
    console.error('Could not open browser automatically. Open this URL manually:');
    console.log(fileUrl);
  } else {
    console.log('✓ Browser launched — FloOwner Control is open.');
  }
});
