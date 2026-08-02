// 全局状态单例（替代 Web 端 Zustand，纯内存、页面间共享）。
export type GenStatus = 'idle' | 'running' | 'done' | 'error';

export interface Generation {
  status: GenStatus;
  imagePath?: string; // 本地缓存文件路径
  error?: string;
}

interface WorkbenchState {
  baseImagePath: string | null; // 上传的角色立绘（本地临时文件）
  characterName: string;
  threeViewPath: string | null; // 三视图（AI 生成后的本地文件）
  provider: 'seedream' | 'gpt-image';
  generations: Record<number, Generation>; // styleId → 生成结果
  lastResultPath: string | null;
  lastStyleId: number | null;
}

export const workbench: WorkbenchState = {
  baseImagePath: null,
  characterName: '',
  threeViewPath: null,
  provider: 'seedream',
  generations: {},
  lastResultPath: null,
  lastStyleId: null,
};

export function resetWorkbench(): void {
  workbench.baseImagePath = null;
  workbench.characterName = '';
  workbench.threeViewPath = null;
  workbench.generations = {};
  workbench.lastResultPath = null;
  workbench.lastStyleId = null;
}
