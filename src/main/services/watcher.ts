import path from 'node:path'
import type { Stats } from 'node:fs'

import { watch, type FSWatcher } from 'chokidar'

import type { WatchEventType, WatchPayload } from '@shared/ipc'
import { toPosix } from '@shared/notes'

import { config } from './config'

let watcher: FSWatcher | null = null

/**
 * 笔记库文件监听（方案 §5.1）。
 *
 * 关键约束：必须忽略 `.git/` 等隐藏目录与忽略列表，否则 Git 操作产生的大量写入
 * 会触发事件风暴，既拖垮 UI 也会形成自触发循环。
 */
export async function startWatching(
  root: string,
  onChange: (payload: WatchPayload) => void
): Promise<void> {
  await stopWatching()

  const ignoredNames = new Set(config.get('ignoredDirNames'))

  watcher = watch(root, {
    ignoreInitial: true,
    // 不用 glob 字符串：chokidar v4 已移除内置 glob 支持，函数匹配器在两个大版本下行为一致
    ignored: (target: string) => {
      if (target === root) return false
      const name = path.basename(target)
      return name.startsWith('.') || ignoredNames.has(name)
    },
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })

  const emit =
    (type: WatchEventType) =>
    (absolute: string, stats?: Stats): void => {
      onChange({
        type,
        path: toPosix(path.relative(root, absolute)),
        // 只在有 stat 的事件上带时间戳：unlink 之类没有 stats
        mtimeMs: stats?.mtimeMs
      })
    }

  watcher
    .on('add', emit('add'))
    .on('change', emit('change'))
    .on('unlink', emit('unlink'))
    .on('addDir', emit('addDir'))
    .on('unlinkDir', emit('unlinkDir'))
    .on('error', (error) => {
      console.error('[watcher] 监听失败', error)
    })
}

/**
 * 关闭监听。
 *
 * 必须等 close 真正完成：换笔记库时是新旧交替的，不等旧 watcher 收尾就直接
 * 监听新目录，旧目录的滞留事件会被当成新库的改动报上去（路径还全是错的）。
 */
export async function stopWatching(): Promise<void> {
  const current = watcher
  watcher = null
  await current?.close().catch(() => undefined)
}
