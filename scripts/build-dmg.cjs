const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/**
 * 把 electron-builder 产出的 .app 打成 .dmg。
 *
 * 为什么不直接让 electron-builder 出 dmg：它的 dmg 目标要先从 GitHub 下载
 * dmgbuild 工具包（几十 MB），国内网络下基本下不动；而 macOS 自带的 hdiutil
 * 就能生成标准的压缩 dmg，全程离线。
 *
 * 代价是 dmg 里没有自定义的窗口背景与图标排布 —— 只有「应用 + Applications
 * 快捷方式」这个拖拽安装的基本盘子。要那种排版的话，把 package.json 的
 * mac.target 改回 ["dir", "dmg"]，等 dmgbuild 下载成功一次之后即可。
 *
 * 用法：npm run dmg（会先跑 pack 得到 .app）
 */

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const productName = pkg.build?.productName ?? pkg.name
const version = pkg.version
const releaseDir = path.join(root, 'release')

/** 在 release/ 下找到 electron-builder 产出的那个 .app（形如 mac-arm64） */
function findApp() {
  const candidates = fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => path.join(releaseDir, entry.name, `${productName}.app`))
    .filter((appPath) => fs.existsSync(appPath))

  if (candidates.length === 0) {
    throw new Error(`没找到打包产物，请先执行 npm run pack（期望 release/*/${productName}.app）`)
  }
  return candidates[0]
}

const appPath = findApp()
// 目录名形如 mac-arm64 → 取出架构写进 dmg 文件名
const arch = path.basename(path.dirname(appPath)).replace(/^mac-/, '') || process.arch
const output = path.join(releaseDir, `${productName}-${version}-${arch}.dmg`)

/** hdiutil create 会把整个盘子原样拷进去，所以先在一个临时目录里摆好布局 */
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-dmg-'))

function build() {
  // ditto 而不是 cp -R：.app 内部有符号链接与可执行位，必须原样保留
  execFileSync('ditto', [appPath, path.join(staging, `${productName}.app`)], { stdio: 'inherit' })
  // 拖到这个快捷方式上就是安装到「应用程序」
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'))

  fs.rmSync(output, { force: true })
  execFileSync(
    'hdiutil',
    [
      'create',
      '-volname',
      productName,
      '-srcfolder',
      staging,
      '-ov',
      // UDZO：只读 + zlib 压缩，最通用的一种 dmg
      '-format',
      'UDZO',
      output
    ],
    { stdio: 'inherit' }
  )

  const size = (fs.statSync(output).size / 1024 / 1024).toFixed(0)
  console.log(`\ndmg 已生成：${path.relative(root, output)}（${size} MB）`)
}

try {
  build()
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
