/**
 * 主题（浅色 / 深色）切换。
 *
 * 实现要点：
 *   1. 主题写在 <html data-theme="..."> 上，样式全部走 tokens.css 的变量，
 *      组件本身不需要知道当前是深色还是浅色；
 *   2. 用户没手动选过就跟随系统（prefers-color-scheme），
 *      并且监听系统切换——用户中途改系统主题，页面要跟着变；
 *   3. 选过之后存 localStorage，下次进来以用户选择为准。
 */

const STORAGE_KEY = 'nut-theme'
export const THEME = { LIGHT: 'light', DARK: 'dark' }

const isDarkSystem = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-color-scheme: dark)').matches

/** 当前生效的主题（已应用到 DOM 上的那个） */
export function getTheme() {
  return document.documentElement.dataset.theme === THEME.DARK
    ? THEME.DARK
    : THEME.LIGHT
}

/** 是否由用户显式指定过（区别于跟随系统） */
export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === THEME.DARK || v === THEME.LIGHT ? v : null
  } catch {
    return null // 隐私模式下 localStorage 可能不可用，退化成跟随系统
  }
}

function apply(theme) {
  document.documentElement.dataset.theme = theme
  // 让浏览器 UI（地址栏、滚动条）也跟着变
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === THEME.DARK ? '#12121a' : '#faf9fc')
}

/** 设置主题；persist=false 表示只应用不记住（用于跟随系统） */
export function setTheme(theme, { persist = true } = {}) {
  apply(theme)
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* 存不了就算了，不影响本次切换 */
    }
  }
}

export function toggleTheme() {
  const next = getTheme() === THEME.DARK ? THEME.LIGHT : THEME.DARK
  setTheme(next)
  return next
}

/**
 * 应用启动时调用一次：按「用户选择 > 系统偏好」决定初始主题，
 * 并订阅系统主题变化（用户没选过时才跟随）。
 */
export function initTheme() {
  const stored = getStoredTheme()
  setTheme(stored || (isDarkSystem() ? THEME.DARK : THEME.LIGHT), { persist: false })

  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  const onChange = (e) => {
    // 用户手动选过就不该被系统覆盖
    if (!getStoredTheme()) setTheme(e.matches ? THEME.DARK : THEME.LIGHT, { persist: false })
  }
  mq?.addEventListener?.('change', onChange)
  return () => mq?.removeEventListener?.('change', onChange)
}
