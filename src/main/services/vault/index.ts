/**
 * 笔记库服务。
 *
 * 按职责拆成几个模块，这里只做汇总导出 —— 对外的模块路径仍是
 * `services/vault`，调用方不需要知道内部是怎么分的：
 *
 * - root  选位置、切库、根路径访问
 * - scan  文件树扫描
 * - notes 笔记读写（含原子写入与 mtime 冲突检测）
 * - images 粘贴 / 拖入的图片落盘
 * - entries 新建笔记与文件夹
 */
export * from './entries'
export * from './images'
export * from './notes'
export * from './root'
export * from './scan'
