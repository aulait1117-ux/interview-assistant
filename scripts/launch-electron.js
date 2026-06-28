#!/usr/bin/env node
/**
 * Claude Code 環境での Electron 起動スクリプト
 * ELECTRON_RUN_AS_NODE=1 が設定されているとElectronがNodeモードで起動し、
 * require('electron') が正しくAPIを返さないため、この変数を削除してから起動する。
 * 参照: https://github.com/anthropics/claude-code/issues/34836
 */
const { spawn } = require('child_process');
const path = require('path');

const electronPath = require('electron');

// 現在の環境変数をコピーしてELECTRON_RUN_AS_NODEを削除
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Electronを正しいパスで起動
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: env,
  cwd: path.join(__dirname, '..'),
});

child.on('close', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Electron起動エラー:', err);
  process.exit(1);
});
