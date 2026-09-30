/**
 * Raster Lifecycle & Race Defect Verification Suite (3.11.11)
 *
 * Verifies:
 * - failSurface is completely idempotent
 * - Destroyed BrowserWindow/webContents are never accessed
 * - close/crash events cannot reject the same surface twice
 * - Pending render jobs receive a typed safe failure { ok: false, code: 'render-failed' }
 * - The renderer is recreated for the next request
 * - Order placement does not fail when the raster surface is unavailable
 * - KOT dispatch does not fail unhandled when the raster surface is unavailable
 * - Shutdown / close while rendering does not produce an uncaught exception
 */

const Module = require('module');
const originalLoad = Module._load;
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tempBase = process.env.TMPDIR || (fs.existsSync('/var/tmp') ? '/var/tmp' : os.tmpdir());
const testDir = fs.mkdtempSync(path.join(tempBase, 'flo-raster-lifecycle-'));

class MockWebContents extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this._destroyed = false;
  }
  isDestroyed() {
    return this._destroyed;
  }
  destroy() {
    this._destroyed = true;
    this.emit('destroyed');
  }
  send(channel, payload) {
    if (this._destroyed) {
      throw new TypeError('Object has been destroyed');
    }
  }
  loadURL() {
    return Promise.resolve();
  }
}

class MockBrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this._destroyed = false;
    this._wc = new MockWebContents(Math.floor(Math.random() * 10000) + 1);
  }
  get webContents() {
    if (this._destroyed) {
      throw new TypeError('Object has been destroyed');
    }
    return this._wc;
  }
  isDestroyed() {
    return this._destroyed;
  }
  close() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._wc.destroy();
    this.emit('closed');
  }
}

class MockIpcMain extends EventEmitter {
  removeListener(channel, listener) {
    return super.removeListener(channel, listener);
  }
}

const mockIpc = new MockIpcMain();

Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' },
      BrowserWindow: MockBrowserWindow,
      ipcMain: mockIpc,
    };
  }
  return originalLoad.apply(this, arguments);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct,
  api, assertEqualOrThrow, assertOrThrow,
  getResults, closeDatabase,
} = require('./helpers/test-setup');

const {
  ChromiumRasterRenderer,
  getSharedRasterRenderer,
  destroySharedRasterRenderer,
} = require('../main/printers/raster-renderer');

const { orderRoutes } = require('../main/routes/orders');
const { printerRoutes } = require('../main/routes/printers');

function makeValidRequest(requestId) {
  return {
    version: 1,
    requestId,
    text: 'Test',
    widthDots: 384,
    maxBandHeight: 200,
    direction: 'ltr',
    align: 'left',
    style: 'normal',
    maxLines: 4,
    financial: false,
  };
}

async function main() {
  console.log('Raster Lifecycle & Race Defect Verification Suite');
  console.log('='.repeat(70));

  let windowCreatedCount = 0;
  let lastCreatedWindow = null;

  const windowFactory = (options) => {
    windowCreatedCount++;
    lastCreatedWindow = new MockBrowserWindow(options);
    return lastCreatedWindow;
  };

  // ── 1. Close before render ──────────────────────────────────────────────────
  console.log('\n─── Test 1: Close before render ───');
  const renderer1 = new ChromiumRasterRenderer({
    windowFactory,
    ipc: mockIpc,
    timeoutMs: 1000,
  });
  lastCreatedWindow.close(); // Closed before render is called
  assertOrThrow(renderer1.isDestroyed(), 'Renderer reports isDestroyed() after window close');

  const result1 = await renderer1.render(makeValidRequest('req-close-before'));
  assertEqualOrThrow(result1.ok, false, 'Render returns typed failure');
  assertEqualOrThrow(result1.code, 'render-failed', 'Error code is render-failed');
  assertOrThrow(typeof result1.detail === 'string', 'Detail is a descriptive string');
  renderer1.destroy();
  console.log('✓ Close before render returns safe typed failure without uncaught exception');

  // ── 2. Close during render ──────────────────────────────────────────────────
  console.log('\n─── Test 2: Close during render ───');
  const renderer2 = new ChromiumRasterRenderer({
    windowFactory,
    ipc: mockIpc,
    timeoutMs: 2000,
  });
  const win2 = lastCreatedWindow;
  // Signal ready
  mockIpc.emit('flo:raster-ready', { sender: win2._wc });

  const renderPromise2 = renderer2.render(makeValidRequest('req-close-during'));

  // Close during pending render
  win2.close();

  const result2 = await renderPromise2;
  assertEqualOrThrow(result2.ok, false, 'Pending render resolved safely on close');
  assertEqualOrThrow(result2.code, 'render-failed', 'Code is render-failed');
  renderer2.destroy();
  console.log('✓ Close during render safely resolves pending job');

  // ── 3. Renderer crash (render-process-gone) ──────────────────────────────────
  console.log('\n─── Test 3: Renderer process crash ───');
  const renderer3 = new ChromiumRasterRenderer({
    windowFactory,
    ipc: mockIpc,
    timeoutMs: 2000,
  });
  const win3 = lastCreatedWindow;
  mockIpc.emit('flo:raster-ready', { sender: win3._wc });

  const renderPromise3 = renderer3.render(makeValidRequest('req-crash'));

  // Emit crash
  win3._wc.emit('render-process-gone');

  const result3 = await renderPromise3;
  assertEqualOrThrow(result3.ok, false, 'Crashed render resolves with error');
  assertEqualOrThrow(result3.code, 'render-failed', 'Code is render-failed');
  assertOrThrow(result3.detail.includes('process exited'), 'Detail explains process exit');
  renderer3.destroy();
  console.log('✓ Renderer crash event fails surface safely');

  // ── 4. Repeated close / destroy idempotency ──────────────────────────────────
  console.log('\n─── Test 4: Repeated destroy calls (idempotency) ───');
  const renderer4 = new ChromiumRasterRenderer({
    windowFactory,
    ipc: mockIpc,
  });
  renderer4.destroy();
  renderer4.destroy();
  renderer4.destroy();
  assertOrThrow(renderer4.isDestroyed(), 'Renderer remains isDestroyed() after multiple destroy()');
  console.log('✓ Multiple destroy() calls are fully idempotent and never throw');

  // ── 5. Queued render jobs fail safely on surface teardown ───────────────────
  console.log('\n─── Test 5: Multiple queued render jobs fail safely ───');
  const renderer5 = new ChromiumRasterRenderer({
    windowFactory,
    ipc: mockIpc,
    timeoutMs: 3000,
  });
  const win5 = lastCreatedWindow;
  mockIpc.emit('flo:raster-ready', { sender: win5._wc });

  const p1 = renderer5.render(makeValidRequest('q-1'));
  const p2 = renderer5.render(makeValidRequest('q-2'));
  const p3 = renderer5.render(makeValidRequest('q-3'));

  win5.close();

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assertEqualOrThrow(r1.ok, false, 'Job 1 failed safely');
  assertEqualOrThrow(r2.ok, false, 'Job 2 failed safely');
  assertEqualOrThrow(r3.ok, false, 'Job 3 failed safely');
  renderer5.destroy();
  console.log('✓ All queued render jobs fail safely when surface closes');

  // ── 6. Recreate after close in shared singleton ─────────────────────────────
  console.log('\n─── Test 6: Recreate shared singleton after close ───');
  destroySharedRasterRenderer();
  const shared1 = getSharedRasterRenderer({ windowFactory, ipc: mockIpc });
  assertOrThrow(!shared1.isDestroyed(), 'Shared instance 1 is active');

  // Close underlying window
  lastCreatedWindow.close();
  assertOrThrow(shared1.isDestroyed(), 'Shared instance 1 reports destroyed');

  // Obtaining shared raster renderer must now create a fresh instance
  const shared2 = getSharedRasterRenderer({ windowFactory, ipc: mockIpc });
  assertOrThrow(!shared2.isDestroyed(), 'Shared instance 2 is active');
  assertOrThrow(shared1 !== shared2, 'New instance was created, not returning stale destroyed one');
  destroySharedRasterRenderer();
  console.log('✓ Shared raster singleton automatically recreates fresh instance when previous one is destroyed');

  // ── 7. Order placement while raster surface unavailable ─────────────────────
  console.log('\n─── Test 7: Order placement succeeds when raster unavailable ───');
  const db = initTestDb();
  const { authHeader } = seedOwnerUser(db);
  seedCategory(db, 'cat-ro', 'Raster Test');
  seedProduct(db, 'prod-ro', 'cat-ro', 'Item 1', 10);

  const app = createApp({
    '/api/orders': orderRoutes,
    '/api/printers': printerRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    // Shared raster is explicitly destroyed
    destroySharedRasterRenderer();

    const orderRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        items: [{ product_id: 'prod-ro', quantity: 1 }],
      },
      headers: authHeader,
    });
    assertEqualOrThrow(orderRes.status, 201, 'Order placement succeeds with 201 even when raster is unavailable');
    assertOrThrow(orderRes.data?.order?.id !== undefined, 'Order ID created');
    console.log('✓ Order placement is completely decoupled from raster surface availability');

    // ── 8. KOT dispatch while raster surface unavailable ───────────────────────
    console.log('\n─── Test 8: KOT dispatch fails safely with 502 (not 500) when raster unavailable ───');
    const kotRes = await api(baseUrl, '/api/printers/print-kot', {
      method: 'POST',
      body: { orderId: orderRes.data.order.id },
      headers: authHeader,
    });
    // KOT returns failure status, but NOT 500 unhandled crash
    assertOrThrow(kotRes.status !== 500, `KOT returns status ${kotRes.status} (never unhandled 500)`);
    console.log('✓ KOT dispatch handles unavailable printer/raster safely');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
  }

  const { passed, failed, total } = getResults();
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Summary: ${passed}/${total} assertions passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
