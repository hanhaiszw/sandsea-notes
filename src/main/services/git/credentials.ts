import { chmodSync } from 'node:fs'

import { safeStorage } from 'electron'
import Store from 'electron-store'

/**
 * Git 凭证存储（方案 §5.3）。
 *
 * 两条硬性要求：
 * 1. Token 绝不写入笔记库目录，也不进日志；
 * 2. 落盘前必须经 safeStorage 加密，并把文件权限收紧到仅本人可读。
 */
interface CredentialData {
  /** safeStorage 加密结果的 base64，空串表示没有凭证 */
  token: string
}

let storeInstance: Store<CredentialData> | null = null

/** safeStorage 不可用时的会话内兜底，进程结束即失效 */
let sessionToken: string | null = null

function store(): Store<CredentialData> {
  storeInstance ??= new Store<CredentialData>({ name: 'credentials', defaults: { token: '' } })
  return storeInstance
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** 保存 Token，返回是否成功落盘（false 表示仅在本次会话有效） */
export function saveToken(token: string): boolean {
  if (!token) {
    clearToken()
    return true
  }

  sessionToken = token

  if (!isEncryptionAvailable()) return false

  const encrypted = safeStorage.encryptString(token).toString('base64')
  const instance = store()
  instance.set('token', encrypted)
  restrictPermissions(instance.path)
  return true
}

export function readToken(): string | null {
  if (sessionToken) return sessionToken

  // 先判断有没有密文：没有就不必触碰系统钥匙串。
  // macOS 上访问钥匙串会弹出系统授权提示，这一步不应在没有凭证时发生。
  const encrypted = store().get('token')
  if (!encrypted) return null
  if (!isEncryptionAvailable()) return null

  try {
    const token = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    sessionToken = token
    return token
  } catch {
    // 系统钥匙串变更或密文损坏：丢弃，要求用户重新填写
    clearToken()
    return null
  }
}

/**
 * 是否已保存凭证。
 *
 * 刻意只判断密文是否存在、不解密：解密需要访问系统钥匙串，而状态栏每次刷新
 * 都会调用到这里（应用一启动就会触发）。把解密推迟到真正需要凭证的 Git 操作，
 * 可以避免每次打开应用都弹出系统密码提示。
 */
export function hasToken(): boolean {
  return sessionToken !== null || store().get('token') !== ''
}

export function clearToken(): void {
  sessionToken = null
  const instance = store()
  instance.set('token', '')
  restrictPermissions(instance.path)
}

function restrictPermissions(filePath: string): void {
  try {
    chmodSync(filePath, 0o600)
  } catch {
    // Windows 等平台不支持该权限位，忽略即可（密文本身已加密）
  }
}
