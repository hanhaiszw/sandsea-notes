import { skippedDiff, type DiffLine, type FileDiff } from '@shared/git'

/** 超过这个字节数就不做行级对比：算出来也没人读，还白占内存 */
export const MAX_DIFF_BYTES = 512 * 1024

/** DP 表的格子数上限（掐掉首尾相同行之后再算），约 16MB 上限 */
const MAX_DIFF_CELLS = 4_000_000

/**
 * 行级差异。
 *
 * 没有引入 diff 库：这里只需要「按行比较」这一种用法，笔记文件也都不大，
 * 一个经典 LCS 就够，不必为它多背一个依赖。
 *
 * 两个降低规模的措施：
 * 1. 先掐掉首尾完全相同的行 —— 笔记的改动通常集中在一小段，
 *    掐完之后需要跑 DP 的只剩「真正变了的那块」；
 * 2. 掐完仍然过大（或二进制内容）就直接标记 skipped，不硬算。
 */
export function buildFileDiff(path: string, before: string, after: string): FileDiff {
  if (isLikelyBinary(before) || isLikelyBinary(after)) return skippedDiff(path)

  const a = splitLines(before)
  const b = splitLines(after)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1

  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  const rows = endA - start
  const cols = endB - start
  // 按 DP 表的实际格子数设限（(rows+1)×(cols+1)），而不是 rows×cols：
  // 后者在「1 行对几百万行」这种形状下会低估约一倍的内存
  if ((rows + 1) * (cols + 1) > MAX_DIFF_CELLS) return skippedDiff(path)

  const lines: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ kind: 'context' as const, text })),
    ...diffMiddle(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text) => ({ kind: 'context' as const, text }))
  ]

  return {
    path,
    lines,
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'del').length,
    skipped: false
  }
}

/** 只对「变过的那一段」做 LCS，并回溯出一条增删记录 */
function diffMiddle(a: string[], b: string[]): DiffLine[] {
  const rows = a.length
  const cols = b.length
  const width = cols + 1

  // 扁平分配成一整块：按行拆成 rows+1 个 Int32Array，行数多时会多出大量小对象
  // table[i * width + j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const table = new Int32Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const index = i * width + j
      table[index] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[index + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      out.push({ kind: 'del', text: a[i] })
      i += 1
    } else {
      out.push({ kind: 'add', text: b[j] })
      j += 1
    }
  }

  while (i < rows) out.push({ kind: 'del', text: a[i++] })
  while (j < cols) out.push({ kind: 'add', text: b[j++] })
  return out
}

/** 拆行；末尾的换行不额外算一行，否则每个文件都会多出一条空差异 */
function splitLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\n$/, '').split('\n')
}

/**
 * 粗略判二进制与超限：出现 NUL 字节就当二进制。
 * 只需要「别把二进制当文本 diff」这一个判断，不必精确识别编码。
 *
 * 体积按 UTF-8 **字节**算：用 `text.length`（UTF-16 码元数）会让中文内容少算到
 * 三分之一左右，512KB 的阈值实际放到 1.5MB —— 与 workingDiff 那边的
 * `stat.size` 判断也就对不上了。
 */
function isLikelyBinary(text: string): boolean {
  if (Buffer.byteLength(text, 'utf8') > MAX_DIFF_BYTES) return true
  return text.includes('\u0000')
}
