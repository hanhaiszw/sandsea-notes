import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * 生产环境 CSP。
 * 开发模式下 Vite 依赖内联脚本与 HMR 的 WebSocket 连接，强 CSP 会直接打断热更新，
 * 因此该策略只在构建产物中注入（apply: 'build'）。
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 预览里的图片走 notes-asset:// 自定义协议（见 src/shared/notes.ts 的 ASSET_SCHEME），
  // 这里的 scheme 必须与它逐字一致，否则打包后图片会被 CSP 直接拦掉
  "img-src 'self' data: blob: notes-asset:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

function injectCsp(): Plugin {
  return {
    name: 'notes:inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />\n  </head>`
      )
    }
  }
}

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  renderer: {
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), injectCsp()]
  }
})
