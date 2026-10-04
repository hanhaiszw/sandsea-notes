import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 笔记库路径守卫。
 *
 * 渲染进程唯一能影响主进程文件系统路径的入口就是「笔记库内的相对路径」，
 * 因此这里必须挡住两类越界：
 *
 * 1. 字符串越界 —— `../` 上溯出笔记库；
 * 2. 符号链接越界 —— 库内放一个指向库外的软链（同步回来的仓库里完全可能有），
 *    字符串比较看不出问题，只有把路径解析成真实路径才能发现。
 *
 * 只做第 1 类是不够的，这正是本模块存在的理由。
 */

/** 把 POSIX 风格相对路径还原成当前平台的写法 */
function toSystemPath(relPath: string): string {
  return relPath.split('/').join(path.sep)
}

/** Windows 文件系统不区分大小写，比较前统一折叠（方案 §3.4） */
function normalizeForCompare(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/** 路径包含判断；纯字符串比较，不碰文件系统 */
export function isInsideRoot(root: string, target: string): boolean {
  const base = normalizeForCompare(root).replace(/[/\\]+$/, '')
  const candidate = normalizeForCompare(target)

  return candidate === base || candidate.startsWith(base + path.sep)
}

/**
 * 把笔记库内的相对路径解析为绝对路径，越界则抛错。
 *
 * 对「最深的已存在祖先」求真实路径再比对一次，是为了兜住两种情况：
 * 目标还不存在（新建 / 写入）时无法对目标本身求 `realpath`，
 * 但它的父目录若是个指向库外的软链，同样必须拦下。
 */
export async function resolveInsideRoot(root: string, relPath: string): Promise<string> {
  const absolute = path.resolve(root, toSystemPath(relPath))
  if (!isInsideRoot(root, absolute)) throw new Error('非法路径：超出笔记库范围')

  const realRoot = await fs.realpath(root).catch(() => null)
  const realProbe = await realpathDeepest(absolute)

  // 笔记库本身取不到真实路径（已被删除或移走）时，退回到字符串校验的结论
  if (realRoot && realProbe && !isInsideRoot(realRoot, realProbe)) {
    throw new Error('非法路径：超出笔记库范围')
  }

  return absolute
}

/** 沿路径向上找第一个真实存在的层级，返回它的真实路径；整条链都不存在时返回 null */
async function realpathDeepest(absolute: string): Promise<string | null> {
  let probe = absolute

  for (;;) {
    const resolved = await fs.realpath(probe).catch(() => null)
    if (resolved) return resolved

    const parent = path.dirname(probe)
    // 已经到文件系统根仍取不到，说明这一层也不存在
    if (parent === probe) return null
    probe = parent
  }
}
