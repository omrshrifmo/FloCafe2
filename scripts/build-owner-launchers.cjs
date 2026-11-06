#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const ownerHtml = path.join(rootDir, 'owner-system', 'flo-owner-control.html');
const releaseDir = path.join(rootDir, 'release');

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

if (fs.existsSync(ownerHtml)) {
  fs.copyFileSync(ownerHtml, path.join(releaseDir, 'flo-owner-control.html'));
  fs.copyFileSync(ownerHtml, path.join(releaseDir, 'flo-owner-control-universal-desktop-and-android.html'));
  console.log('[Launcher Builder] Copied owner control HTML to release/');
}

const batPath = path.join(releaseDir, 'Launch-FloOwner-Control-Windows.bat');
const batContent = `@echo off
setlocal
title FloOwner Control System v4.7.2

if exist "%~dp0Flo Cafe.exe" (
    start "" "%~dp0Flo Cafe.exe" --owner-app
    exit /b 0
)

if exist "%ProgramFiles%\\Flo Cafe\\Flo Cafe.exe" (
    start "" "%ProgramFiles%\\Flo Cafe\\Flo Cafe.exe" --owner-app
    exit /b 0
)

if exist "%LOCALAPPDATA%\\Programs\\Flo Cafe\\Flo Cafe.exe" (
    start "" "%LOCALAPPDATA%\\Programs\\Flo Cafe\\Flo Cafe.exe" --owner-app
    exit /b 0
)

if exist "%LOCALAPPDATA%\\Programs\\flo-desktop\\Flo Cafe.exe" (
    start "" "%LOCALAPPDATA%\\Programs\\flo-desktop\\Flo Cafe.exe" --owner-app
    exit /b 0
)

set "HTML_PATH=%~dp0flo-owner-control-universal-desktop-and-android.html"
if not exist "%HTML_PATH%" set "HTML_PATH=%~dp0flo-owner-control.html"

where msedge >nul 2>&1
if %ERRORLEVEL% equ 0 (
    start msedge --app="%HTML_PATH%"
    exit /b 0
)

where chrome >nul 2>&1
if %ERRORLEVEL% equ 0 (
    start chrome --app="%HTML_PATH%"
    exit /b 0
)

start "" "%HTML_PATH%"
exit /b 0
`;

fs.writeFileSync(batPath, batContent, 'utf8');
console.log('[Launcher Builder] Generated release/Launch-FloOwner-Control-Windows.bat');
