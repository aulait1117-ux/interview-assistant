'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * electronAPI として安全にフロントエンドへ公開する
 * contextBridge を使うことでレンダラーから Node.js へ直接アクセスさせない
 */
contextBridge.exposeInMainWorld('electronAPI', {

  // --- ウィンドウ操作 ---

  /** ウィジェットを通常サイズに展開する */
  expand: () => ipcRenderer.send('window:expand'),

  /** ウィジェットサイズに縮小する */
  collapse: () => ipcRenderer.send('window:collapse'),

  /** ウィンドウを最小化する */
  minimize: () => ipcRenderer.send('window:minimize'),

  /** ウィンドウを閉じる */
  close: () => ipcRenderer.send('window:close'),

  /** ウィンドウを非表示にする */
  hide: () => ipcRenderer.send('window:hide'),

  /** ウィンドウを表示する */
  show: () => ipcRenderer.send('window:show'),

  /** 常に最前面表示をトグルする */
  toggleAlwaysOnTop: () => ipcRenderer.send('window:toggle-always-on-top'),

  /**
   * ドラッグによるウィンドウ移動
   * @param {number} deltaX - X軸の移動量（px）
   * @param {number} deltaY - Y軸の移動量（px）
   */
  moveWindow: (deltaX, deltaY) =>
    ipcRenderer.send('window:move', { deltaX, deltaY }),

  /**
   * 現在のウィンドウ位置を取得（非同期）
   * @returns {Promise<{ x: number, y: number }>}
   */
  getPosition: () => ipcRenderer.invoke('window:get-position'),

  /**
   * 現在のウィンドウサイズを取得（非同期）
   * @returns {Promise<{ width: number, height: number }>}
   */
  getSize: () => ipcRenderer.invoke('window:get-size'),

  /**
   * ウィンドウサイズを変更する
   * @param {number} width
   * @param {number} height
   */
  setSize: (width, height) =>
    ipcRenderer.send('window:set-size', { width, height }),

  /**
   * ウィンドウの透明度を変更する
   * @param {number} opacity - 0.0（完全透明）〜 1.0（不透明）
   */
  setOpacity: (opacity) => ipcRenderer.send('window:set-opacity', opacity),

  // --- イベントリスナー ---

  /**
   * alwaysOnTop の状態変化を購読する
   * @param {(isAlwaysOnTop: boolean) => void} callback
   * @returns {() => void} リスナーを解除する関数
   */
  onAlwaysOnTopChanged: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('window:always-on-top-changed', listener);
    // クリーンアップ関数を返す（React の useEffect などで使用）
    return () => ipcRenderer.removeListener('window:always-on-top-changed', listener);
  },

  // --- オーバーレイウィンドウ連携 ---

  /**
   * ヒントデータをオーバーレイウィンドウへ送信する
   * @param {{ question: string, answer: string, isStreaming: boolean, streamingText: string }} data
   */
  sendHintsToOverlay: (data) =>
    ipcRenderer.send('overlay:update-hints', data),

  /** オーバーレイウィンドウの表示/非表示をトグル */
  toggleOverlay: () => ipcRenderer.send('overlay:toggle-visibility'),

  /** オーバーレイウィンドウを表示する */
  showOverlay: () => ipcRenderer.send('overlay:show'),

  /** オーバーレイウィンドウを非表示にする */
  hideOverlay: () => ipcRenderer.send('overlay:hide'),

  // --- 環境情報 ---

  /** 認証トークンをメインプロセスへ送信（オーバーレイ共有用） */
  sendToken: (token) => ipcRenderer.send('auth:set-token', token),

  /** デスクトップソース一覧を取得（システム音声キャプチャ用） */
  getDesktopSources: () => ipcRenderer.invoke('desktop:get-sources'),

  /** 実行環境が Electron かどうかを示すフラグ */
  isElectron: true,

  /** プラットフォーム名（'win32' / 'darwin' / 'linux'） */
  platform: process.platform,
});
