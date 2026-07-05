import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_SIZE, splitName } from '../lib/prompts';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';

interface PosterVariant {
  id: string;
  label: string;
  template: string;
}

const POSTER_VARIANTS: PosterVariant[] = [
  {
    id: 'classic',
    label: '海报版',
    template:
      '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；在此前提下进行如下风格化：绝区零影画风格，角色动态动作姿势，重墨黑白线稿与大块剪影，高对比明暗，仅以单一「{DOMINANT_COLOR}」色作点缀强调，辅以「{ACCENT_COLOR}」，图片顶部左侧超大做旧印刷体英文「{NAME_TOP}」，图片底部右侧超大做旧印刷体英文「{NAME_BOTTOM}」，角色主体站在画面中央人物脸部清晰不被文字遮挡，底部有一行小字星级副标题信息，斜切几何色块，胶带/贴纸做旧质感，噪点与扫描线，无水印。',
  },
  {
    id: 'author',
    label: '自由版',
    template:
      '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；在此前提下进行如下风格化：绝区零影画风格，角色动态动作姿势，重墨黑白线稿与大块剪影，高对比明暗，仅以单一「{DOMINANT_COLOR}」色作点缀强调，辅以「{ACCENT_COLOR}」，背景为巨大角色英文名「{NAME}」做旧排版字，人物脸部清晰不被文字遮挡，斜切几何色块，胶带/贴纸做旧质感，噪点与扫描线，无水印。',
  },
  {
    id: 'surprise',
    label: '意外版',
    template:
      '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；原始立绘是唯一角色身份参考，生成的必须是上传图片中的角色本人，严禁自行设计或创造新角色，所有面部特征、五官比例、发型发色、体型、服装细节必须与三视图的角色完全一致；画面必须为横向构图（landscape，宽大于高，3:2 横幅），不需要展示角色全身，突出角色特点与个性，但角色下胸部以上必须完整呈现于画面中；角色做出动作后人物主体约占画面80%~95%；最终画面只保留角色主体与正常比例英文名字文字，不要任何额外贴纸、徽标、条码、说明字、小标签或背景装饰。在此前提下进行如下风格化：输出尺寸严格锁定为1536×1024像素（3:2横向构图），严禁改变画幅尺寸或裁剪范围。色彩与上色——全彩高饱和赛璐珞：角色进行完整全彩高饱和赛璐珞上色，色彩鲜艳饱满、明亮夺目，严禁暗淡、灰蒙、去饱和或黑白灰处理；真实自然的肤色质感（暖调蜜桃肤色，带有自然红晕与高光）；以「{DOMINANT_COLOR}」为主色调贯穿角色服装、头发、配饰，配合「{ACCENT_COLOR}」作为辉光、高光边缘、点缀色与氛围色提高整体色彩冲击力；肌肤展现（核心要求，优先级最高）：在保持角色姿势、位置、身体轮廓和面部身份像素级不变的前提下，仅通过对服装部件的大幅删减来增加大幅肌肤露出——必须执行以下至少4项处理：去除外套/披风、去除外层遮挡/护甲、大幅缩短裙摆至大腿以上、大幅缩短袖长至肩部附近、降低领口露出锁骨与肩颈、开放整个背部、开放腰腹、减少腿部布料覆盖至短裤/热裤程度。删减仅作用于服装本身，保留的服装必须保持原三视图的版型与材质。背景——纯白无杂质：纯白色（#FFFFFF）铺满整个画面背景区域，无任何渐变、噪点、纹理、阴影或暗角；文字位置、大小、字形与输入图片完全一致，仅{NAME_TOP}和{NAME_BOTTOM}两个英文文字层；文字不透明度100%、完全实心，不可透过文字看到后方角色；{NAME_TOP}文字颜色强制使用{TEXT_TOP_BRIGHT}，{NAME_BOTTOM}文字颜色强制使用{TEXT_BOTTOM}，两者均不得使用其他颜色。角色动态：低重心姿态，身体大面积接触支撑面；微动态细节（打哈欠/wink/半睁眼/比耶/拉领带/抱玩偶）；画面整体呈现慵懒私密的氛围感，如同角色在自己房间中毫无防备的放松瞬间。光照采用45度柔和顶光作为全局光源，全图所有元素均受此光源影响；服装与头发的亮暗由光照方向与布料褶皱、发丝走向共同决定，同一材质因褶皱朝向不同呈现不同明暗，形成自然光影层次；明暗交界清晰但不锐利，皮肤带有高光反射。整体为卸防感的非战斗姿态，衣装微松——脱去外套、松开领口、拉下领带，呈现私密状态。肌肤细节：皮肤带汗珠或自然油光，增强真实的体温感。质感与细节：强烈明暗对比，做旧噪点；角色主体脸部清晰，细节高精度，整体呈现绝区零官方Mindscape Cinema影画的明亮全彩印刷品美学。',
  },
];

function fillPoster(template: string, name: string, dominant: string, accent: string, textTopBright?: string, textBottom?: string): string {
  const upper = (name || 'CHARACTER').toUpperCase();
  const [top, bottom] = splitName(upper);
  return template
    .replaceAll('{NAME_TOP}', top)
    .replaceAll('{NAME_BOTTOM}', bottom)
    .replaceAll('{NAME}', upper)
    .replaceAll('{DOMINANT_COLOR}', dominant)
    .replaceAll('{ACCENT_COLOR}', accent)
    .replaceAll('{TEXT_TOP_BRIGHT}', textTopBright ?? '#e099ff')
    .replaceAll('{TEXT_BOTTOM}', textBottom ?? '#cc66ff');
}

/** Section 06 — one-click ZZZ poster generation, author-recommended prompt. */
export function PosterPanel() {
  const { characterName, palette, posterSlot, setPosterSlot, provider, threeViewSlot } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();
  const [variant, setVariant] = useState<string>(POSTER_VARIANTS[1].id);
  const [lightbox, setLightbox] = useState(false);

  const current = POSTER_VARIANTS.find((v) => v.id === variant) ?? POSTER_VARIANTS[0];
  const dominant = palette?.dominant ?? '#b026ff';
  const accent = palette?.accent ?? '#ff2d9b';
  const prompt = fillPoster(current.template, characterName, dominant, accent, palette?.textTopBright, palette?.textBottom);

  const run = async () => {
    const threeViewImg = threeViewSlot.images[0];
    if (!threeViewImg) {
      showError('请先在 01 模块生成三视图');
      return;
    }
    setPosterSlot({ status: 'loading', error: undefined });
    try {
      const images = await generate(
        buildRequest(prompt, { size: YINGHUA_SIZE, imageOverride: threeViewImg }),
      );
      setPosterSlot({ status: 'done', images });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setPosterSlot({ status: 'error', error: msg });
      showError(msg);
    }
  };

  return (
    <section className="glass p-6">
      <SectionHeader step="06" title="作者推荐 · 绝区零特色提示词 · 自由 / 海报版 · 一键生成" />

      <div className="-mt-2 mb-3 flex items-center gap-2">
        {POSTER_VARIANTS.map((v) => (
          <button
            key={v.id}
            onClick={() => setVariant(v.id)}
            className={`glass-btn px-3 py-1 font-mono text-[11px] uppercase tracking-widest ${
              variant === v.id ? 'text-zzz-primary' : 'text-zzz-text/50'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Reference thumbnail — shows only the active variant, click to enlarge */}
      <div className="mb-3 overflow-hidden rounded-lg border border-zzz-text/10">
        <img
          src={`/作者推荐/${current.label}_thumb.jpg`}
          alt={`${current.label} 示例`}
          className="mx-auto max-w-xs w-full cursor-pointer"
          loading="lazy"
          onClick={() => setLightbox(true)}
        />
        <p className="px-2 py-1 font-mono text-[10px] text-zzz-text/45">{current.label} 参考图 · 点击放大</p>
      </div>

      <textarea
        value={prompt}
        readOnly
        rows={5}
        className="glass-input mb-3 w-full resize-y px-3 py-2 font-mono text-xs leading-relaxed text-zzz-text/80"
      />

      <button
        onClick={() => void run()}
        disabled={posterSlot.status === 'loading'}
        className="glass-btn w-full py-2.5 font-mono text-sm uppercase tracking-widest text-zzz-text disabled:opacity-40"
      >
        一键生成海报
      </button>

      <ResultView
        slot={posterSlot}
        downloadPrefix="zzz-poster"
        saveInfo={posterSlot.images[0] ? {
          imageUrl: posterSlot.images[0],
          style: current.label,
          characterName,
          prompt,
          provider,
        } : undefined}
      />

      {/* Lightbox overlay */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(false)}
        >
          <img
            src={`/作者推荐/${current.label}.png`}
            alt={`${current.label} 示例`}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </section>
  );
}
