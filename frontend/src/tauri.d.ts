/**
 * Tauri API 类型声明（仅桌面端可用）
 * Web 端编译时不依赖 @tauri-apps/api，此处声明模块接口避免 TS 编译错误
 */
declare module '@tauri-apps/api/core' {
  export function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T>
}
