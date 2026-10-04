import type { BrowserWindow } from 'electron'

import { IpcChannel } from '@shared/ipc'

/**
 * 退出前的落盘协商。
 *
 * 自动保存有 700ms 防抖，用户敲完最后一个字立刻退出（Cmd+Q）时会丢掉那一小段。
 * 退出流程因此拆成两步：主进程先请求渲染层立刻保存，渲染层写完回报，
 * 再真正退出。
 *
 * 渲染层没有回应时绝不能卡住退出，所以这里带一个硬超时 —— 退出流程永远能继续。
 */

/** 等待渲染层落盘的上限；超过就照常退出 */
const FLUSH_TIMEOUT_MS = 800

/** 等待中的退出放行回调；同一时刻只会有一个 */
let releasePending: (() => void) | null = null

/** 渲染层报告「已经写完」时调用，放行被拦下的退出 */
export function notifyFlushDone(): void {
  releasePending?.()
}

/** 请渲染层把编辑器里还没落盘的内容写完；无论成功与否都会 resolve */
export function requestFlush(window: BrowserWindow): Promise<void> {
  if (window.webContents.isDestroyed()) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      releasePending = null
      resolve()
    }, FLUSH_TIMEOUT_MS)

    releasePending = () => {
      clearTimeout(timer)
      releasePending = null
      resolve()
    }

    window.webContents.send(IpcChannel.appFlush)
  })
}
