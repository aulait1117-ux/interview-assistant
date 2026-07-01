'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, session } = require('electron');
// desktopCapturer はレンダラー専用（Electron 21+）。mainプロセスではnullとして扱う
let desktopCapturer = null;
try { desktopCapturer = require('electron').desktopCapturer; } catch (_) {}
const path = require('path');
const url = require('url');

// 開発環境か本番環境かを判定
const isDev = process.env.NODE_ENV === 'development';


// --- オーバーレイウィンドウ ---
let overlayWindow = null;

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 420,
    height: 520,
    x: sw - 440,
    y: Math.floor(sh / 2) - 260,

    // 透過・フレームレス・常に最前面
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,

    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev,
    },
  });

  // WindowsではalwaysOnTopのレベルを上げてZoomなどの上に表示
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  if (isDev) {
    overlayWindow.loadURL('http://localhost:5173/overlay.html');
  } else {
    const overlayPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'frontend', 'dist', 'overlay.html');
    overlayWindow.loadURL(
      url.format({ pathname: overlayPath, protocol: 'file:', slashes: true })
    );
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  // 開発時: DevToolsを別ウィンドウで自動起動（デバッグ用）
  if (isDev) {
    overlayWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // ロード失敗時のリトライ（開発時のみ）
  overlayWindow.webContents.on('did-fail-load', () => {
    if (isDev) {
      setTimeout(() => {
        if (overlayWindow) overlayWindow.loadURL('http://localhost:5173/overlay.html');
      }, 3000);
    }
  });
}

// 16x16 の青い正方形アイコンを RGBA バッファから直接生成する
// 外部ファイル不要・確実に動作する方法
function createTrayIcon() {
  const size = 16;
  // RGBA 4バイト/ピクセル: R=59, G=130, B=246 (Tailwind blue-500), A=255
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4 + 0] = 59;   // R
    buf[i * 4 + 1] = 130;  // G
    buf[i * 4 + 2] = 246;  // B
    buf[i * 4 + 3] = 255;  // A
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

let mainWindow = null;
let tray = null;

// トレイメニューを再構築する（alwaysOnTop の状態が変わるたびに呼ぶ）
function buildTrayMenu() {
  const isOnTop = mainWindow ? mainWindow.isAlwaysOnTop() : true;

  return Menu.buildFromTemplate([
    {
      label: '透明度',
      submenu: [
        {
          label: '100%（不透明）',
          click: () => { if (mainWindow) mainWindow.setOpacity(1.0); },
        },
        {
          label: '80%',
          click: () => { if (mainWindow) mainWindow.setOpacity(0.8); },
        },
        {
          label: '60%',
          click: () => { if (mainWindow) mainWindow.setOpacity(0.6); },
        },
        {
          label: '40%',
          click: () => { if (mainWindow) mainWindow.setOpacity(0.4); },
        },
        {
          label: '20%（かなり透明）',
          click: () => { if (mainWindow) mainWindow.setOpacity(0.2); },
        },
      ],
    },
    {
      label: `常に最前面: ${isOnTop ? 'ON' : 'OFF'}`,
      click: () => {
        if (!mainWindow) return;
        const next = !mainWindow.isAlwaysOnTop();
        mainWindow.setAlwaysOnTop(next);
        mainWindow.webContents.send('window:always-on-top-changed', next);
        // メニューを最新状態に更新
        tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    {
      label: 'ウィンドウを表示',
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
        mainWindow.moveTop();
      },
    },
    {
      label: '終了',
      click: () => { app.quit(); },
    },
  ]);
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('面接サポート');
  tray.setContextMenu(buildTrayMenu());

  // 左クリックでウィンドウをトグル表示/非表示
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ウィジェットの状態管理
const WIDGET_SIZE = { width: 200, height: 60 };
const EXPANDED_SIZE = { width: 400, height: 600 };
let isExpanded = false;

// アニメーション付きでウィンドウサイズを変更する
function animateResize(targetWidth, targetHeight) {
  if (!mainWindow) return;
  const [startW, startH] = mainWindow.getSize();
  const steps = 12;
  const duration = 180; // ms
  const interval = duration / steps;
  let step = 0;

  const timer = setInterval(() => {
    step++;
    const t = step / steps;
    // ease-out: 減速しながら終点へ
    const eased = 1 - Math.pow(1 - t, 3);
    const w = Math.round(startW + (targetWidth - startW) * eased);
    const h = Math.round(startH + (targetHeight - startH) * eased);
    if (mainWindow) mainWindow.setSize(w, h);
    if (step >= steps) {
      clearInterval(timer);
      if (mainWindow) mainWindow.setSize(targetWidth, targetHeight);
    }
  }, interval);
}

function createWindow() {
  // ディスプレイ情報を取得（マルチモニター対応）
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WIDGET_SIZE.width,
    height: WIDGET_SIZE.height,
    x: screenWidth - WIDGET_SIZE.width - 20,   // 右端に配置
    y: Math.floor((screenHeight - WIDGET_SIZE.height) / 2),
    minWidth: WIDGET_SIZE.width,
    minHeight: WIDGET_SIZE.height,
    maxWidth: 800,
    maxHeight: 900,
    resizable: false,

    // 透明・フレームレス・常時最前面
    transparent: true,
    alwaysOnTop: true,
    frame: false,
    backgroundColor: '#00000000',

    // macOS 向け追加設定
    titleBarStyle: 'hidden',
    vibrancy: 'under-window',

    // セキュリティ設定
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,      // セキュリティのためコンテキスト分離を有効化
      nodeIntegration: false,      // レンダラーでのNode.js直接利用を禁止
      sandbox: false,              // preloadスクリプトのrequireを許可
      devTools: isDev,             // 開発時のみDevToolsを有効化
    },
  });

  // ロードするURLを環境によって切り替え
  if (isDev) {
    // 開発時: Viteの開発サーバーを使用
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 本番時: asarUnpack済みの静的ファイルをロード
    const indexPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'frontend', 'dist', 'index.html');
    mainWindow.loadURL(
      url.format({
        pathname: indexPath,
        protocol: 'file:',
        slashes: true,
      })
    );
  }

  // ウィンドウが閉じられたときの処理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 読み込みエラー時のフォールバック
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`ページロード失敗: ${errorDescription} (コード: ${errorCode})`);
    if (isDev) {
      // 開発サーバーが未起動の可能性があるため、少し待ってリトライ
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.loadURL('http://localhost:5173');
        }
      }, 3000);
    }
  });
}

// --- IPC ハンドラ ---

// ウィジェットを展開する（小さい → 通常サイズ）
ipcMain.on('window:expand', () => {
  if (!mainWindow || isExpanded) return;
  isExpanded = true;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  // 展開後の位置: 右端に収まるよう調整
  const [currentX, currentY] = mainWindow.getPosition();
  const newX = Math.max(0, Math.min(currentX, screenWidth - EXPANDED_SIZE.width - 20));
  mainWindow.setPosition(newX, currentY);
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(300, 400);
  animateResize(EXPANDED_SIZE.width, EXPANDED_SIZE.height);
});

// ウィジェットを縮小する（通常 → 小さいサイズ）
ipcMain.on('window:collapse', () => {
  if (!mainWindow || !isExpanded) return;
  isExpanded = false;
  mainWindow.setResizable(false);
  mainWindow.setMinimumSize(WIDGET_SIZE.width, WIDGET_SIZE.height);
  animateResize(WIDGET_SIZE.width, WIDGET_SIZE.height);
});

// ウィンドウを最小化
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

// ウィンドウを閉じる（アプリ終了）
ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// ウィンドウを非表示にする（タスクトレイへ退避するなどに利用）
ipcMain.on('window:hide', () => {
  if (mainWindow) mainWindow.hide();
});

// ウィンドウを表示する
ipcMain.on('window:show', () => {
  if (mainWindow) mainWindow.show();
});

// alwaysOnTop のトグル
ipcMain.on('window:toggle-always-on-top', () => {
  if (mainWindow) {
    const current = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!current);
    mainWindow.webContents.send('window:always-on-top-changed', !current);
  }
});

// ウィンドウ移動（ドラッグによる位置変更）
// フロントから { deltaX, deltaY } を受け取り、現在位置からの差分で移動
ipcMain.on('window:move', (event, { deltaX, deltaY }) => {
  if (!mainWindow) return;
  const [currentX, currentY] = mainWindow.getPosition();
  mainWindow.setPosition(currentX + deltaX, currentY + deltaY);
});

// 現在のウィンドウ位置を返す（同期IPC）
ipcMain.handle('window:get-position', () => {
  if (!mainWindow) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

// 現在のウィンドウサイズを返す（同期IPC）
ipcMain.handle('window:get-size', () => {
  if (!mainWindow) return { width: 400, height: 600 };
  const [width, height] = mainWindow.getSize();
  return { width, height };
});

// ウィンドウのサイズを変更
ipcMain.on('window:set-size', (event, { width, height }) => {
  if (mainWindow) mainWindow.setSize(width, height);
});

// ウィンドウの透明度を変更（0.0〜1.0）
ipcMain.on('window:set-opacity', (event, opacity) => {
  if (mainWindow) mainWindow.setOpacity(opacity);
});

// --- オーバーレイ IPC ハンドラ ---

// メインアプリからヒントデータをオーバーレイへ中継
ipcMain.on('overlay:update-hints', (_event, data) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:hints-updated', data);
  }
});

// オーバーレイウィンドウの表示/非表示をトグル
ipcMain.on('overlay:toggle-visibility', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
    return;
  }
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    overlayWindow.show();
  }
});

// オーバーレイウィンドウを表示する
ipcMain.on('overlay:show', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  } else {
    overlayWindow.show();
  }
});

// オーバーレイウィンドウを非表示にする
ipcMain.on('overlay:hide', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
});

// オーバーレイ自身を前面に持ってくる
ipcMain.on('overlay:focus-self', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  }
});

// 透明領域のマウス貫通（パネル外はクリックをZoom等に通す）
ipcMain.on('overlay:set-ignore-mouse', (_event, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// オーバーレイウィンドウの透明度を変更
ipcMain.on('overlay:set-opacity', (_event, opacity) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(opacity);
  }
});

// オーバーレイウィンドウをドラッグ移動（差分）
ipcMain.on('overlay:move', (_event, { deltaX, deltaY }) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const [x, y] = overlayWindow.getPosition();
  overlayWindow.setPosition(x + deltaX, y + deltaY);
});

// オーバーレイウィンドウの位置を取得
ipcMain.handle('overlay:get-position', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return { x: 0, y: 0 };
  const [x, y] = overlayWindow.getPosition();
  return { x, y };
});

// オーバーレイウィンドウのサイズを取得
ipcMain.handle('overlay:get-size', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return { width: 420, height: 520 };
  const [width, height] = overlayWindow.getSize();
  return { width, height };
});

// オーバーレイウィンドウのサイズと位置を同時に設定（全辺リサイズ用）
ipcMain.on('overlay:set-bounds', (_event, { x, y, width, height }) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds({ x, y, width, height }, false);
});

// カーソル追跡リサイズ（ウィンドウ外でもマウス座標を取得できる）
let resizeInterval = null;
ipcMain.on('overlay:resize-start', (_event, { dir, startX, startY, origX, origY, origW, origH }) => {
  if (resizeInterval) clearInterval(resizeInterval);
  resizeInterval = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) { clearInterval(resizeInterval); return; }
    const pt = screen.getCursorScreenPoint();
    const dx = pt.x - startX;
    const dy = pt.y - startY;
    let nx = origX, ny = origY, nw = origW, nh = origH;
    if (dir.includes('e')) nw = Math.max(280, origW + dx);
    if (dir.includes('w')) { nw = Math.max(280, origW - dx); nx = origX + (origW - nw); }
    if (dir.includes('s')) nh = Math.max(200, origH + dy);
    if (dir.includes('n')) { nh = Math.max(200, origH - dy); ny = origY + (origH - nh); }
    overlayWindow.setBounds({ x: Math.round(nx), y: Math.round(ny), width: Math.round(nw), height: Math.round(nh) }, false);
  }, 16);
});

ipcMain.on('overlay:resize-end', () => {
  if (resizeInterval) { clearInterval(resizeInterval); resizeInterval = null; }
});

// --- アプリのライフサイクル ---

const OVERLAY_ONLY = process.env.OVERLAY_ONLY === 'true'

// 認証トークンをメインプロセスで保持（オーバーレイへのリレー用）
let _authToken = null;
ipcMain.on('auth:set-token', (_event, token) => { _authToken = token; });
ipcMain.handle('auth:get-token', () => _authToken);

// IPC: システム音声キャプチャ用のデスクトップソース一覧を返す
ipcMain.handle('desktop:get-sources', async () => {
  if (!desktopCapturer) return []
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  return sources.map(s => ({ id: s.id, name: s.name }))
})

app.whenReady().then(() => { try {
  // getUserMedia でデスクトップ音声キャプチャを許可する
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  // getDisplayMedia をインターセプト: ダイアログなしでシステム音声（WASAPIループバック）を返す
  if (desktopCapturer) {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' })
      }).catch(() => callback({}))
    })
  }

  if (!OVERLAY_ONLY) createWindow();
  createOverlayWindow();
  createTray();

  // macOS: Dock アイコンクリックでウィンドウを再作成
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!OVERLAY_ONLY) createWindow();
      createOverlayWindow();
    }
  });
} catch (e) {
  require('fs').writeFileSync(require('path').join(require('os').homedir(), 'electron-error.log'), String(e) + '\n' + e.stack);
  app.quit();
}
});

// 全ウィンドウが閉じられてもトレイが存在する場合はアプリを終了しない
// トレイの「終了」メニューから app.quit() で明示終了する
app.on('window-all-closed', () => {
  // トレイが存在する場合はバックグラウンドで動き続ける
  // トレイがない場合（macOS 以外）のみ終了
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// セキュリティ: 新しいウィンドウの作成をブロック
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url: targetUrl }) => {
    console.warn(`外部URLへのアクセスをブロック: ${targetUrl}`);
    return { action: 'deny' };
  });
});
