// ThoughtRings 纯正 Electron 高性能通信网桥
export async function invoke<T = any>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return await (window as any).electronAPI.invoke(cmd, args);
  }
  throw new Error(`[IPC Bridge] 无法定位 Electron 宿主环境 (命令: ${cmd})`);
}

export function convertFileSrc(filePath: string): string {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return `atom://${filePath}`;
  }
  return filePath;
}
