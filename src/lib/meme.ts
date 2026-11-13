import type { GenRequest, GptImageQuality, ProviderName } from '../types';
import { withDenoise } from './denoise';
import { parseDataUrl } from './validation';

export interface MemeReference { id: string; name: string; dataUrl: string }
export interface MemeTileDraft { id: string; expression: string; caption: string; reference: MemeReference | null }
export interface MemeDraft {
  count: 9 | 15;
  character: MemeReference | null;
  styles: MemeReference[];
  expressions: MemeReference[];
  tiles: MemeTileDraft[];
}
export interface MemeGenerationOptions {
  provider: ProviderName;
  useServerPreset: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  quality?: GptImageQuality;
  denoiseEnabled: boolean;
  maxInputImages: number;
  transparencySupported: boolean;
}

const PRESETS = [
  ['挥手微笑，热情打招呼', '嗨～'], ['举起双手，开心庆祝', '好耶！'],
  ['认真点头，比出OK手势', '收到'], ['双手合十，真诚感谢', '谢谢你'],
  ['歪头疑惑，头顶小问号', '嗯？'], ['半眯眼，欲言又止的无语表情', '无语了'],
  ['鼓起脸颊，叉腰生气', '哼！'], ['趴着休息，精疲力尽', '累了'],
  ['抱着枕头，困倦地道晚安', '晚安'], ['准备飞快逃跑，慌张又可爱', '溜了溜了'],
  ['双手比心，周围漂浮小爱心', '贴贴'], ['自信挑眉，竖起拇指', '拿捏了'],
  ['夸张地流泪崩溃，戏剧化反应', '我裂了'], ['瞪大双眼，难以置信', '哈？？'],
  ['握拳打气，充满干劲', '加油！'],
] as const;

export function createMemeDraft(): MemeDraft {
  return { count: 9, character: null, styles: [], expressions: [], tiles: PRESETS.map(([expression, caption], i) => ({ id: `meme-${i + 1}`, expression, caption, reference: null })) };
}

/** Only active cells enter the immutable generation snapshot. */
export function snapshotMemeDraft(draft: MemeDraft): MemeDraft {
  return { ...draft, character: draft.character ? { ...draft.character } : null,
    styles: draft.styles.map((image) => ({ ...image })), expressions: draft.expressions.map((image) => ({ ...image })),
    tiles: draft.tiles.slice(0, draft.count).map((tile) => ({ ...tile, reference: tile.reference ? { ...tile.reference } : null })) };
}

export function memeReferenceCount(draft: MemeDraft): number {
  return (draft.character ? 1 : 0) + draft.styles.length + draft.expressions.length
    + draft.tiles.slice(0, draft.count).filter((tile) => tile.reference).length;
}

/** Build image order and its prompt descriptions together; never number them separately. */
export function buildMemeRequest(draft: MemeDraft, options: MemeGenerationOptions,
  redo?: { index: number; previousDataUrl: string }): GenRequest {
  if (options.provider !== 'gpt-image') throw new Error('请在右上角「设置」选择 GPT 图片通道，或开启作者免费通道。');
  if (!draft.character) throw new Error('请先上传角色图，或复用当前角色。');
  if (!options.transparencySupported) throw new Error('当前模型尚未确认支持透明输出。请在设置中选择支持透明 PNG 的 GPT 图片模型，不会自动更换模型。');
  if (!options.useServerPreset && (!options.apiKey.trim() || !options.baseUrl.trim() || !options.model.trim())) {
    throw new Error('请先在右上角「设置」填写 GPT 图片接口，或开启作者免费通道。');
  }
  if (draft.count !== 9 && draft.count !== 15) throw new Error('请选择九宫格或15格。');
  if (draft.styles.length > 3 || draft.expressions.length > 3) throw new Error('风格参考与共用表情参考各最多3张。');
  if (draft.tiles.length < draft.count) throw new Error('表情配置不完整，请重新选择格数。');
  if (redo && (!Number.isInteger(redo.index) || redo.index < 0 || redo.index >= draft.count)) throw new Error('重做的表情不存在。');
  if (!redo && memeReferenceCount(draft) > 16) throw new Error('输入图片合计最多16张，请减少参考图。');
  const selected = redo ? [draft.tiles[redo.index]] : draft.tiles.slice(0, draft.count);
  if (selected.some((tile) => !tile.expression.trim() || tile.expression.length > 600 || tile.caption.length > 40)) {
    throw new Error('每格需要动作或神态描述（最多600字），文案最多40字。');
  }

  const images: MemeReference[] = [];
  const descriptions: string[] = [];
  const add = (image: MemeReference, purpose: string) => {
    images.push(image); descriptions.push(`图片${images.length}：${purpose}。`);
    return images.length;
  };
  add(draft.character, '角色身份参考，决定画谁，保持角色基础特征与原生身体结构');
  draft.styles.forEach((image) => add(image, '全套共用的画风参考，只决定线稿、上色、比例和绘画表现，不移植其中的角色身份、文字与背景'));
  draft.expressions.forEach((image) => add(image, '全套共用的表情参考，只参考情绪张力、神态和动作，不改变角色身份与指定文案'));
  const cells = selected.map((tile, i) => {
    const index = redo ? redo.index : i;
    const imageIndex = tile.reference ? add(tile.reference, `仅用于第${index + 1}格的神态和动作参考，优先于共用表情参考，不改变角色身份`) : null;
    return `${redo ? '本张表情' : `第${index + 1}格（第${Math.floor(index / (draft.count === 9 ? 3 : 5)) + 1}行第${index % (draft.count === 9 ? 3 : 5) + 1}列）`}：动作和神态：${tile.expression.trim()}；${tile.caption.trim() ? `准确绘制中文文案${JSON.stringify(tile.caption.trim())}` : '不绘制文字'}${imageIndex ? `；参考图片${imageIndex}的表情` : ''}。`;
  });
  if (redo) add({ id: 'previous-tile', name: '上一版表情', dataUrl: redo.previousDataUrl }, '本张表情上一版结果，参考其角色表现、贴纸白边和整体画法；修正动作、神态与指定文案，并保持透明背景');
  if (images.length > Math.min(16, options.maxInputImages)) throw new Error(`当前模型最多支持${options.maxInputImages}张输入图（包含角色与重做参考），请减少参考图。`);
  const textless = selected.every((tile) => !tile.caption.trim());
  const prompt = [
    '制作可直接用于聊天的角色表情贴纸，输出真实透明背景的PNG。',
    redo ? '只生成一张独立表情，不要网格，不要拼图。' : `输出一张3行${draft.count === 9 ? 3 : 5}列、共${draft.count}格的表情贴纸网格图，从左到右、从上到下严格对应下列清单。每格等宽等高。`,
    '每张贴纸包含角色、指定文字与必要装饰，四周保留安全留白。主体、耳朵、头发、文字、装饰及投影均不得触碰或跨越格子边界。不要绘制分格线、序号或标题。',
    textless ? '本次全部为无字表情包。不绘制任何语言的文字、字母、数字或拟声词，也不抄写参考图中的文字。保留厚实、均匀的白色贴纸轮廓，可保留问号、感叹号、小爱心与汗滴等情绪装饰。' : '角色与文字周围保留厚实、均匀的白色贴纸轮廓；文字圆润粗壮、扁平纯色、有深色描边且清晰可读，不遮挡脸部。不增加清单以外的文字或水印。',
    '背景必须是实际alpha透明；不要纯白底、彩色底、场景或画出来的棋盘格。保留文字、白色轮廓、分离的小爱心、汗滴与半透明抗锯齿边缘。',
    '角色图决定身份；风格图决定画法；表情图决定神态与动作。保留发型发色、瞳色、服饰配色、饰品及原生四肢、尾巴、翅膀等结构，不强行改成人形。',
    draft.styles.length ? '以风格参考的画法为优先，保持全套风格统一，同时严格保持角色辨识度。' : '沿用角色参考图的原有绘画风格，全套保持统一。',
    '参考图片用途（按实际输入顺序）：', ...descriptions,
    '逐格内容（文案以此为准，参考图中的文字不替代指定文案）：', ...cells,
  ].join('\n');
  const parsed = images.map((image) => parseDataUrl(image.dataUrl));
  const request = withDenoise({ provider: 'gpt-image', prompt,
    imageBase64: parsed[0].base64, imageMime: parsed[0].mime,
    ...(parsed.length > 1 ? { refImages: parsed.slice(1).map(({ base64, mime }) => ({ base64, mime })) } : {}),
    background: 'transparent', output_format: 'png', n: 1,
    size: redo || draft.count === 9 ? '1024x1024' : '1536x1024',
    preserveInputQuality: true, inputImageMaxDimension: 1536,
    ...(options.quality !== undefined ? { quality: options.quality } : {}),
    ...(options.useServerPreset ? { useServerPreset: true } : {
      apiKey: options.apiKey.trim(), baseUrl: options.baseUrl.trim(), model: options.model.trim(),
    }), idempotencyKey: crypto.randomUUID(),
  }, options.denoiseEnabled);
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 50 * 1024 * 1024 - 1024) {
    throw new Error('参考图片合计过大，超过请求上限。请缩小或减少图片后再生成。');
  }
  return request;
}
