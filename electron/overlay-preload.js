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

  // --- 環境情報 ---

  /** Electron 環境フラグ */
  isElectron: true,

  /** オーバーレイウィンドウフラグ */
  isOverlay: true,

  /** プラットフォーム名 */
  platform: process.platform,
});
