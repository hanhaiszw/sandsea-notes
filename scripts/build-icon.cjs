const { app, BrowserWindow, nativeImage } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * 从 build/icon.svg 生成图标产物：
 *   build/icon.png   1024×1024；运行时设 macOS Dock 图标用，也是 Linux / Windows 的窗口图标
 *   build/icon.icns  macOS 打包用（electron-builder 会自动认这个路径，暂未配置打包）
 *
 * 用 Electron 自带的 Chromium 做光栅化：机器上不需要装任何 SVG 转换工具，
 * 而且每个尺寸都直接从矢量渲染，比拿 1024 位图逐级缩放清晰。
 *
 * 用法：npm run icon
 */

// 裸跑脚本时 Electron 会用默认的 ~/Library/Application Support/Electron，
// 那个目录在受限环境下可能写不进去，渲染进程会直接垮掉
app.setPath('userData', path.join(os.tmpdir(), 'notes-icon-userdata'))
app.disableHardwareAcceleration()

const project = process.cwd()
const buildDir = path.join(project, 'build')
const source = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8')

/** iconset 要求的文件名与像素尺寸（同一个尺寸可能被两处引用） */
const RENDERS = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]

/** 在渲染进程里把 SVG 画到 canvas 再导出 PNG，顺便量出琥珀色字形的包围盒 */
function renderScript(size) {
  return `
    (async () => {
      try {
        const size = ${size}
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return { error: '拿不到 2d 上下文' }

        const image = new Image()
        image.src = 'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(${JSON.stringify(source)})
        await image.decode()
        ctx.drawImage(image, 0, 0, size, size)

        const data = ctx.getImageData(0, 0, size, size).data
        let minX = size, minY = size, maxX = -1, maxY = -1
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const i = (y * size + x) * 4
            // 琥珀色：不透明、红高蓝低
            if (data[i + 3] > 200 && data[i] > 150 && data[i + 2] < 120) {
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          }
        }
        return { dataUrl: canvas.toDataURL('image/png'), box: [minX, minY, maxX, maxY] }
      } catch (error) {
        return { error: String((error && error.stack) || error) }
      }
    })()
  `
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 1200 })
  // 不能用 data: URL 做顶层导航，Chromium 会拦掉，loadURL 永远不 resolve
  await win.loadURL('about:blank')

  // 中间产物放临时目录，只把最终的 png / icns 留在 build/
  const iconset = path.join(os.tmpdir(), 'notes-icon.iconset')
  fs.rmSync(iconset, { recursive: true, force: true })
  fs.mkdirSync(iconset, { recursive: true })

  const report = {}

  for (const [size, name] of RENDERS) {
    const result = await win.webContents.executeJavaScript(renderScript(size))

    if (result.error) {
      console.error('[icon] 渲染失败：', result.error)
      app.exit(1)
      return
    }

    const buffer = nativeImage.createFromDataURL(result.dataUrl).toPNG()
    fs.writeFileSync(path.join(iconset, name), buffer)

    const [minX, minY, maxX, maxY] = result.box
    if (maxX < 0) {
      report[size] = '没找到字形'
    } else {
      // 顺便报出相对画布中心的偏移，用来确认字形真的居中
      const dx = (minX + maxX + 1) / 2 - size / 2
      const dy = (minY + maxY + 1) / 2 - size / 2
      report[size] =
        `${maxX - minX + 1}×${maxY - minY + 1}px 中心偏移(${dx.toFixed(1)},${dy.toFixed(1)})`
    }
  }

  fs.copyFileSync(
    path.join(iconset, 'icon_512x512@2x.png'),
    path.join(buildDir, 'icon.png')
  )

  const master = nativeImage.createFromPath(path.join(buildDir, 'icon.png'))
  if (master.isEmpty()) {
    console.error('[icon] 生成的 icon.png 读不出来')
    app.exit(1)
    return
  }

  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(buildDir, 'icon.icns')])
  }

  fs.rmSync(iconset, { recursive: true, force: true })

  console.log('[icon] icon.png', JSON.stringify(master.getSize()))
  console.log('[icon] 字形尺寸（确认居中的依据）：', JSON.stringify(report))
  if (process.platform !== 'darwin') {
    console.log('[icon] 非 macOS 平台，跳过 icon.icns')
  }

  app.exit(0)
})

process.on('unhandledRejection', (error) => {
  console.error('[icon] 失败：', error)
  app.exit(1)
})
