/**
 * navigate.ts
 * Render静的サイトのSPAリライト設定が本番で効いていないため、
 * /desktop-guide 等への遷移はフルページ遷移（<a href>のデフォルト動作）を避け、
 * pushStateでのページ内遷移に統一する。
 * App.tsx側は 'app-navigate' イベントをlistenしてpathname stateを更新する。
 */
export function navigateTo(path: string, e?: { preventDefault: () => void }) {
  e?.preventDefault()
  window.history.pushState({}, '', path)
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: path }))
}
