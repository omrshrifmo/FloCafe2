'use strict';

const fs = require('fs');
const { app, BrowserWindow } = require('electron');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  app.whenReady().then(async () => {
    let outputFile = null;
    try {
      const payload = JSON.parse(input);
      outputFile = payload.outputFile || null;
      const { request, fonts, renderScript } = payload;

      const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: false,
        },
      });

      await win.loadURL('about:blank');

      const fullScript = `(${renderScript})(${JSON.stringify(request)}, ${JSON.stringify(fonts)})`;
      const result = await win.webContents.executeJavaScript(fullScript);

      const jsonStr = JSON.stringify(result);
      if (outputFile) {
        fs.writeFileSync(outputFile, jsonStr, 'utf8');
      } else {
        process.stdout.write(jsonStr);
      }
    } catch (err) {
      const errPayload = JSON.stringify({
        ok: false,
        code: 'render-failed',
        error: err && err.message ? err.message : String(err),
      });
      if (outputFile) {
        fs.writeFileSync(outputFile, errPayload, 'utf8');
      } else {
        process.stdout.write(errPayload);
      }
    } finally {
      app.quit();
    }
  });
});

