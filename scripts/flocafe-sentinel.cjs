#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const candidateDistPaths = [
  path.resolve(__dirname, '../dist/main/sentinel/sentinel-daemon.js'),
  path.resolve(__dirname, '../../app.asar.unpacked/dist/main/sentinel/sentinel-daemon.js'),
  path.resolve(__dirname.replace(/app\.asar$/, 'app.asar.unpacked').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'), '../dist/main/sentinel/sentinel-daemon.js'),
];

let distEntry = candidateDistPaths.find((p) => fs.existsSync(p));
const tsEntry = path.resolve(__dirname, '../main/sentinel/sentinel-daemon.ts');

if (distEntry) {
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
