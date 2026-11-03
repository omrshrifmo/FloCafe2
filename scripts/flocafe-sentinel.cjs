#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const distEntry = path.resolve(__dirname, '../dist/main/sentinel/sentinel-daemon.js');
const tsEntry = path.resolve(__dirname, '../main/sentinel/sentinel-daemon.ts');

if (fs.existsSync(distEntry)) {
  const daemon = require(distEntry);
  if (typeof daemon.startSentinelDaemon === 'function') {
    daemon.startSentinelDaemon();
  }
} else {
  // Development fallback via ts-node
  require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '../tsconfig.json'),
  });
  const daemon = require(tsEntry);
  if (typeof daemon.startSentinelDaemon === 'function') {
    daemon.startSentinelDaemon();
  }
}
