// Electronの初期化が完了した後にmain.jsを実行する
// browser_init.jsはmain.jsのロード後に実行されるため、
// 次のイベントループでmain.jsをrequireすることでAPIが利用可能になる
setTimeout(() => {
  require('./electron/main');
}, 0);
