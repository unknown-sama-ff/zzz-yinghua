import { ApiError } from './apiClient';
import { resolveInpaintTarget } from './inpaintTarget';
import { submitImageEdit, type ImageEditOutcome } from './submitImageEdit';
import { useInpaintStore } from '../store/useInpaintStore';
import { useYinghuaStore } from '../store/useYinghuaStore';
import type { InpaintTarget } from '../types';

export const ONE_CLICK_LEG_REPAIR_INSTRUCTION = '修复当前单人角色图中的第三条腿、多余小腿分支或腿部错接。先从髋部沿大腿、膝盖、小腿、脚踝到脚确认每条腿的归属，优先保留结构完整的两条连接；完整程度相近时，优先保留处于画面上方、髋膝连接清楚的腿，同时保留另一条正确的前景腿。不要仅按脚的位置或可见脚数决定删除对象。只有确认存在多余分支时才删除该分支及其鞋袜并恢复背景；没有多余腿时，只局部整理错位关节与轮廓。保持原视角、透视、裁切、主体动作、衣装、脸、头发、道具、文字和其他区域，禁止通过换姿势或重新构图解决问题。';

/** One deliberate click starts one ordinary edit; results remain un-applied. */
export async function startOneClickLegRepair(target: InpaintTarget): Promise<ImageEditOutcome> {
  const editor = useInpaintStore.getState();
  if (editor.isGenerating || useYinghuaStore.getState().activeGeneration) return { status: 'busy' };
  if (target.type !== 'yinghua' && target.type !== 'yinghua-draft') {
    throw new ApiError('INVALID_INPUT', '一键修腿目前支持动作底稿和影画结果');
  }
  const { url, ...location } = target;
  const currentTarget = resolveInpaintTarget(url, 'yinghua', location);
  if (currentTarget.type === 'preview') throw new ApiError('INVALID_INPUT', '原图已更新，请从当前结果重新开始修复');
  editor.openWorkspace(currentTarget);
  useInpaintStore.getState().setPrompt(ONE_CLICK_LEG_REPAIR_INSTRUCTION);
  return submitImageEdit({ instruction: ONE_CLICK_LEG_REPAIR_INSTRUCTION, editMode: 'smart' });
}
