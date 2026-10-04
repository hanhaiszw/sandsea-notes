import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { SaveImageInput, SavedImage } from '@shared/ipc'
import { IMAGES_DIR_NAME, MAX_IMAGE_BYTES, isImageExtension, toPosix } from '@shared/notes'

import { requireVaultRoot } from './root'

/**
 * 把粘贴 / 拖入的图片落到笔记库根目录的 images/ 下。
 *
 * 刻意只接收二进制内容、不接受来源路径：渲染进程无法借此指使主进程
 * 去读笔记库外的任意文件。图片固定在根目录的 images/ 下，
 * 引用路径由渲染层按笔记所在层级换算。
 */
export async function saveImage(input: SaveImageInput): Promise<SavedImage> {
  const root = requireVaultRoot()

  const extension = input.extension.replace(/^\./, '').toLowerCase()
  if (!isImageExtension(extension)) {
    throw new Error(`不支持的图片格式：${input.extension || '（未知）'}`)
  }

  const data = toBuffer(input.data)
  if (data.byteLength === 0) throw new Error('图片内容为空')
  if (data.byteLength > MAX_IMAGE_BYTES) {
    const limit = MAX_IMAGE_BYTES / 1024 / 1024
    throw new Error(`图片过大（${(data.byteLength / 1024 / 1024).toFixed(1)} MB），上限 ${limit} MB`)
  }

  const dir = path.join(root, IMAGES_DIR_NAME)
  await fs.mkdir(dir, { recursive: true })

  const target = await writeImageFile(dir, extension, data)
  return { path: toPosix(path.relative(root, target)) }
}

/** IPC 传来的二进制可能是 Buffer / Uint8Array / ArrayBuffer，统一成 Buffer 再写 */
function toBuffer(data: SaveImageInput['data']): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(data as unknown as ArrayBuffer)
}

/**
 * 写入并返回实际落盘路径。
 *
 * 命名带秒级时间戳；同秒内连粘多张图靠 'wx'（目标存在即失败）递增序号，
 * 而不是先探测再写 —— 后者存在竞态，会让两张图互相覆盖。
 */
async function writeImageFile(dir: string, extension: string, data: Buffer): Promise<string> {
  const stamp = formatStamp(new Date())

  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`
    const target = path.join(dir, `image-${stamp}${suffix}.${extension}`)

    try {
      await fs.writeFile(target, data, { flag: 'wx' })
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  throw new Error('同一秒内写入的图片过多，请稍后重试')
}

/** 本地时间戳，形如 20260929-153012 */
function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}
