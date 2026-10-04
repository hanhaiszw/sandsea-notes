import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './styles/global.css'

document.documentElement.dataset['platform'] = window.notes.platform
// 首帧之前先落主题，否则浅色主题下会闪一下深色底
document.documentElement.dataset['theme'] = window.notes.initialTheme

const container = document.getElementById('root')
if (!container) throw new Error('找不到挂载节点 #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
