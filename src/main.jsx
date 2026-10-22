import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// token 必须最先加载：后面所有样式都引用这里的变量
import './styles/tokens.css'
import './index.css'
import App from './App.jsx'
// 必须在首屏渲染前定好主题，否则会先闪一下浅色再变黑
import { initTheme } from './lib/theme'

initTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
