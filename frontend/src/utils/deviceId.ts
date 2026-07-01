const DEVICE_ID_KEY = 'device_id'

/** ブラウザに永続する端末IDを取得（なければ生成）。無料プランの使い回し防止に使用 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}
