import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BrowserWindow, app, nativeImage, nativeTheme, session, shell } from 'electron'

import { isMac, toPlatformId } from '@shared/platform'
import { WINDOW_BACKGROUND, resolveTheme } from '@shared/theme'

import { registerIpc } from './ipc'
import { registerAssetScheme, serveAssetProtocol } from './services/assets'
import { readPreferences } from './services/config'
import { requestFlush } from './services/lifecycle'
import { stopWatching } from './services/watcher'

/**
 * 应用显示名：打包后 Dock、菜单栏、关于面板、Finder 都读它。
 *
 * 注意开发模式下 macOS 菜单栏仍显示「Electron」——那个名字取自正在运行的
 * Electron 二进制自带 Info.plist 的 CFBundleName，app.setName 改不动它
 * （所以开发时想看到自己的图标也只能显式设一次 Dock 图标，见下方 whenReady）。
 * 打包后会读我们自己的 Info.plist（CFBundleName 已是「Sandsea Notes」），显示即正常。
 */
const APP_NAME = 'Sandsea Notes'

/**
 * 用户数据目录名，与显示名刻意分开。
 *
 * 改名时若连目录一起改，appData 下会多出一个空目录，
 * 用户此前选好的笔记库、主题、Git 设置全部读不到（对用户而言就是「配置没了」）。
 * 所以这里固定沿用最初的名字，改显示名不影响既有数据。
 */
const APP_DATA_DIR = 'Notes'

const platform = toPlatformId(process.platform)

/**
 * 允许交给系统浏览器打开的协议。
 *
 * 刻意用白名单：链接来自笔记正文，是任何人都能写的。`file://`、`smb://`
 * 或任意自定义 scheme 交给系统去打开，等于把「点一下链接」变成执行未知行为。
 */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 只把 http(s) / mailto 交给系统浏览器，其余一律不打开 */
function openExternal(url: string): void {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    // 连 URL 都解析不出来：不打开
    return
  }

  if (!EXTERNAL_PROTOCOLS.has(protocol)) return
  void shell.openExternal(url).catch(() => undefined)
}

/**
 * 是不是「应用自己的页面」。
 *
 * 刻意不用 `startsWith(devServerUrl)`：`http://localhost:5173.evil.com` 同样
 * 以它开头，会被误判成自有页面。开发模式比 origin，打包后比完整的文件 URL。
 */
function isOwnPage(url: string, devServerUrl: string | undefined, appFileUrl: string): boolean {
  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }

  return url === appFileUrl || url.startsWith(`${appFileUrl}#`)
}

/**
 * 窗口使用的内存会话（不带 persist: 前缀）。
 * 原因：Chromium 会为持久化的 cookies / localStorage 做加密，在 macOS 上
 * 这需要访问系统钥匙串，进而弹出「Electron 想要使用您钥匙串中的机密信息」提示。
 * 本应用的界面不使用任何 cookies 或 localStorage，用内存会话即可切断这条链路。
 *
 * 自定义协议必须注册到「这个名字对应的会话」上，见 serveAssetProtocol。
 */
const SESSION_PARTITION = 'notes-memory'

/*
 * 必须在 app ready 之前设定应用名与用户数据目录。
 * 否则 Electron 会退回默认名（Chromium），把配置写进一个与应用无关的目录。
 */
app.setName(APP_NAME)
app.setPath('userData', path.join(app.getPath('appData'), APP_DATA_DIR))

// 自定义协议的注册同样有「ready 之前」的时序要求
registerAssetScheme()

/**
 * 应用图标（由 build/icon.svg 生成，见 npm run icon）。
 *
 * 只在未打包时用到：打包后 macOS 读的是 .app 里的 icon.icns，
 * Windows / Linux 的安装包图标由打包配置指定（暂未配置打包）。
 */
const appIconPath = path.join(app.getAppPath(), 'build/icon.png')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // 窗口底色必须与当前主题一致：渲染进程绘制之前以及缩放过程中会露出它
  const theme = resolveTheme(readPreferences().theme, nativeTheme.shouldUseDarkColors)
  const icon = nativeImage.createFromPath(appIconPath)

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    show: false,
    // macOS 忽略这一项（它用 Dock 图标），Linux / Windows 用它当窗口图标
    icon: icon.isEmpty() ? undefined : icon,
    backgroundColor: WINDOW_BACKGROUND[theme],
    // 窗口装饰按平台分支（方案 §3.4）：macOS 用内嵌标题栏，其余平台沿用系统标题栏
    titleBarStyle: isMac(platform) ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // 安全基线（方案 §4.1）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 内存会话，避免 Chromium 为持久化存储去访问 macOS 钥匙串
      partition: SESSION_PARTITION,
      // 把主题与版本号交给 preload：主题要在首次绘制前就定下来，版本号给「关于」用。
      // 两者都是一次性只读信息，不值得为此各开一条 IPC 通道。
      additionalArguments: [`--notes-theme=${theme}`, `--notes-version=${app.getVersion()}`]
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 一切外部链接交给系统浏览器，应用内不开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  // 打包后页面就是这一个本地文件，它也是唯一允许在窗口内停留的自有地址
  const appFileUrl = pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString()

  // 预览里的链接是可点击的：必须拦住同窗口跳转，否则点一下就离开了应用界面
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(url, devServerUrl, appFileUrl)) return

    event.preventDefault()
    openExternal(url)
  })

  if (!app.isPackaged && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  registerIpc(() => mainWindow)
  // 必须注册到窗口实际使用的那个会话，注册到默认会话渲染进程认不出这个协议
  serveAssetProtocol(session.fromPartition(SESSION_PARTITION))

  // 未打包时 macOS 的 Dock 显示的是 Electron 自带图标（只有打包后才会读 .app 里的 icns），
  // 所以开发时想看到自己的图标只能显式设一次
  if (!app.isPackaged && isMac(platform)) {
    const icon = nativeImage.createFromPath(appIconPath)
    if (!icon.isEmpty()) app.dock?.setIcon(icon)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac(platform)) app.quit()
})

/**
 * 退出流程是否已经走过一次「先落盘再退」的协商。
 *
 * 协商完调 app.quit() 会再次触发 before-quit，靠这个标记放行第二次，
 * 否则会无限拦下自己。
 */
let flushNegotiated = false

app.on('before-quit', (event) => {
  void stopWatching()

  if (flushNegotiated) return

  const window = mainWindow
  // 没有窗口就没什么可落盘的，直接退
  if (!window || window.webContents.isDestroyed()) return

  event.preventDefault()
  flushNegotiated = true

  // 自动保存有 700ms 防抖，这里先让渲染层把编辑器里的内容写完再退
  void requestFlush(window).then(() => app.quit())
})
