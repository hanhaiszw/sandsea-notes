import { promises as fs } from 'node:fs'
import path from 'node:path'

import { protocol, type Session } from 'electron'

import { ASSET_SCHEME, ASSET_URL_HOST, MAX_IMAGE_BYTES, imageMimeType } from '@shared/notes'

import { resolveInsideRoot } from './paths'
import { optionalVaultRoot } from './vault'

/**
 * 预览里的本地图片走自定义协议加载（方案 §5.2）。
 *
 * 为什么不用 file://：开发模式下渲染进程的源是 http://localhost，
 * Chromium 不允许 http(s) 页面加载 file:// 资源；退一步说，即便放开，
 * 页面也就拿到了整个文件系统的读权限。自定义协议让每个请求都回到主进程
 * 逐个校验，只放行笔记库内的图片。
 *
 * URL 形状：notes-asset://vault/<笔记库内的相对路径>（形如 notes-asset://vault/images/a.png）
 */

/** 必须在 app ready 之前调用，否则协议不会被当作标准协议解析 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      // standard：按 scheme://host/path 解析；secure：视为安全上下文，否则会被当作混合内容拦掉
      privileges: { standard: true, secure: true, stream: true }
    }
  ])
}

/**
 * 在 app ready 之后调用，target 必须是窗口真正使用的那个会话。
 *
 * 关键点：protocol.handle 只对**指定会话**生效。窗口跑在 partition: 'notes-memory'
 * 这个内存会话里，如果只注册到默认会话，渲染进程会拿 net::ERR_UNKNOWN_URL_SCHEME——
 * 主进程能取到图，页面却认不出这个协议。
 */
export function serveAssetProtocol(target: Session): void {
  target.protocol.handle(ASSET_SCHEME, async (request) => {
    const relative = assetRelativePath(request.url)
    if (!relative) return notFound()

    const root = optionalVaultRoot()
    if (!root) return notFound()

    let absolute: string
    try {
      absolute = await resolveInsideRoot(root, relative)
    } catch {
      // 越出笔记库的路径一律当作不存在，不向渲染进程透露原因
      return notFound()
    }

    // 只提供图片：即使有人在笔记里写了别的文件路径，这里也不会把它交出去
    const mime = imageMimeType(path.extname(absolute))
    if (!mime) return notFound()

    // 主进程侧也卡一道体积上限：只靠渲染层自觉的话，一个超大的「图片」
    // 会被整块读进内存再交给页面
    const stat = await fs.stat(absolute).catch(() => null)
    if (!stat?.isFile() || stat.size > MAX_IMAGE_BYTES) return notFound()

    const data = await fs.readFile(absolute).catch(() => null)
    if (!data) return notFound()

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': mime,
        // 图片名带时间戳，基本不会被改写；长缓存避免每次预览重渲染都重新读盘
        'Cache-Control': 'public, max-age=86400'
      }
    })
  })
}

/** 从请求 URL 取出笔记库内的相对路径；形状不符时返回 null */
function assetRelativePath(requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }

  if (url.hostname !== ASSET_URL_HOST) return null

  // 百分比编码要在 URL 归一化之后才解码：%2e%2e%2f 这类绕行由 resolveInsideVault 兜底
  const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  return decoded === '' ? null : decoded
}

function notFound(): Response {
  return new Response(null, { status: 404 })
}
