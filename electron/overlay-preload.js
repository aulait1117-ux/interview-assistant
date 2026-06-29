'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * overlayAPI: オーバーレイウィンドウ専用の安全なブリッジ
 * contextBridge 経由でレンダラーに公開する
 */
contextBridge.exposeInMainWorld('overlayAPI', {

  // --- ウィンドウ操作 ---

  /** オーバーレイを非表示にする */
  hide: () => ipcRenderer.send('overlay:hide'),

  /** オーバーレイを前面に表示する */
  focus: () => ipcRenderer.send('overlay:focus-self'),

  /**
   * ドラッグによるウィンドウ移動
   * @param {number} deltaX
   * @param {number} deltaY
   */
  moveWindow: (deltaX, deltaY) =>
    ipcRenderer.send('overlay:move', { deltaX, deltaY }),

  /**
   * ウィンドウの透明度を変更する
   * @param {number} opacity - 0.0〜1.0
   */
  setOpacity: (opacity) => ipcRenderer.send('overlay:set-opacity', opacity),

  /**
   * 現在のウィンドウ位置を取得
   * @returns {Promise<{ x: number, y: number }>}
   */
  getPosition: () => ipcRenderer.invoke('overlay:get-position'),

  /**
   * 現在のウィンドウサイズを取得
   * @returns {Promise<{ width: number, height: number }>}
   */
  getSize: () => ipcRenderer.invoke('overlay:get-size'),

  /**
   * ウィンドウの位置とサイズを同時に設定（全辺リサイズ用）
   */
  setBounds: (x, y, width, height) => ipcRenderer.send('overlay:set-bounds', { x, y, width, height }),

  /** カーソル追跡リサイズ開始（ウィンドウ外でも動作） */
  resizeStart: (params) => ipcRenderer.send('overlay:resize-start', params),

  /** カーソル追跡リサイズ終了 */
  resizeEnd: () => ipcRenderer.send('overlay:resize-end'),

  /** パネル外の透明領域でマウスを貫通させる */
  setIgnoreMouse: (ignore) => ipcRenderer.send('overlay:set-ignore-mouse', ignore),

  // --- ヒントデータ受信 ---

  /**
   * メインアプリからヒント更新イベントを購読する
   * @param {(data: OverlayHintData) => void} callback
   * @returns {() => void} リスナー解除関数
   */
  onHintsUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('overlay:hints-updated', listener);
    return () => ipcRenderer.removeListener('overlay:hints-updated', listener);
  },

  /** デスクトップソース一覧を取得（システム音声キャプチャ用） */
  getDesktopSources: () => ipcRenderer.invoke('desktop:get-sources'),

  /** メインプロセスから認証トークンを取得 */
  getToken: () => ipcRenderer.invoke('auth:get-token'),

  // --- 環境情報 ---

  /** Electron 環境フラグ */
  isElectron: true,

  /** オーバーレイウィンドウフラグ */
  isOverlay: true,

  /** プラットフォーム名 */
  platform: process.platform,
});
