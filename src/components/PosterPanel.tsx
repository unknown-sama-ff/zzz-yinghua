import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_SIZE, splitName } from '../lib/prompts';
import { combineImagesSideBySide } from '../lib/combineImages';
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
      '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；画面必须为横向构图（landscape，宽大于高，3:2 横幅），不需要展示角色全身，突出角色特点与个性，但角色腰部以上必须完整呈现于画面中；角色做出动作后人物应当撑满画面90%以上；在此前提下进行如下风格化：绝区零影画风格，画风与原三视图保持完全一致；输出尺寸严格锁定为1536×1024像素（3:2横向构图），严禁改变画幅尺寸或裁剪范围。色彩与上色——全彩高饱和赛璐珞：角色进行完整全彩高饱和赛璐珞上色，色彩鲜艳饱满、明亮夺目，严禁暗淡、灰蒙、去饱和或黑白灰处理；真实自然的肤色质感（肤色必须与三视图中角色的原始肤色完全一致，带有自然红晕与高光）；以「{DOMINANT_COLOR}」为主色调贯穿角色服装、头发、配饰，配合「{ACCENT_COLOR}」作为辉光、高光边缘、点缀色与氛围色提高整体色彩冲击力；完整保留原角色服饰设计样式、剪裁风格与配色不做任何改动，所有固有色、阴影色、高光色必须忠于原设；服装改造——【强制要求 · 不可跳过·服装大幅精简】基于原角色服饰设计基因进行创新改造，保留原设计的配色、图案纹样与装饰元素，大幅精简服装布料、显著减少身体的遮蔽面积。衣服可因不可抗因素（战斗、动作、环境）而导致撕裂/损毁，也可采用开放性设计/战损风格：① 开放性设计——缩短裙摆/改无袖/深V领/露背/露腰/热裤化；② 战损风——因战斗撕裂破损。必须完成以下至少6项：1. 脱掉外套/披风 2. 去除护甲/外层遮挡 3. 裙摆缩短至大腿以上 4. 袖子缩短至肩部 5. 领口降低露出锁骨与肩颈 6. 背部敞开 7. 腰腹露出 8. 腿部布料减至短裤；完整保留服饰原有的设计样式与配色不做改动；背景——纯白无杂质：背景为纯白色（#FFFFFF）铺满整个画面背景区域，绝对纯白，无任何渐变、无噪点、无杂色、无纹理、无阴影、无暗角，呈现干净的印刷品底色质感；文字处理——超大做旧印刷体叠压：超大做旧印刷体英文{NAME_TOP}和{NAME_BOTTOM}尺寸极大（单字高度占画面高度的30%-45%），采用高饱和{TEXT_BOTTOM}或{TEXT_TOP_BRIGHT}做旧色，边缘带有粗糙磨损、噪点、印刷错位与墨点飞溅质感；文字分布于画面上下边缘（顶部一行、底部一行），必须与角色产生前后遮挡与叠压关系——文字可被角色头发、肢体、道具、服装部分覆盖，也可衬于角色身体后方，形成丰富的空间纵深感；严禁为避免遮挡而缩小文字、改变文字位置或移动至空旷角落；质感与细节：强烈明暗对比，做旧噪点，斜切几何色块，工业贴纸UI质感，网点纸/半调纹理（halftone dot pattern），印刷做旧质感，扫描线；角色主体脸部清晰，细节高精度，整体呈现绝区零官方Mindscape Cinema影画的明亮全彩印刷品美学。',
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
  const characterName = useStore((s) => s.characterName);
  const uploadedImage = useStore((s) => s.uploadedImage);
  const palette = useStore((s) => s.palette);
  const posterSlot = useStore((s) => s.posterSlot);
  const setPosterSlot = useStore((s) => s.setPosterSlot);
  const provider = useStore((s) => s.provider);
  const yinghuaSlots = useStore((s) => s.yinghuaSlots);
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();
  const [variant, setVariant] = useState<string>(POSTER_VARIANTS[1].id);
  const [lightbox, setLightbox] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState('');

  const current = POSTER_VARIANTS.find((v) => v.id === variant) ?? POSTER_VARIANTS[0];
  const dominant = palette?.dominant ?? '#b026ff';
  const accent = palette?.accent ?? '#ff2d9b';
  const prompt = fillPoster(current.template, characterName, dominant, accent, palette?.textTopBright, palette?.textBottom);

  const run = async () => {
    const zeroImg = yinghuaSlots[1]?.images[0];
    const mainImg = zeroImg || uploadedImage;
    if (!mainImg) {
      showError('请先上传角色图片或生成零命');
      return;
    }
    // If we have both zero-fate and uploaded image, combine them as dual reference.
    const imageOverride = (zeroImg && uploadedImage)
      ? await combineImagesSideBySide(zeroImg, uploadedImage)
      : mainImg;
    setPosterSlot({ status: 'loading', error: undefined });
    try {
      const images = await generate(
        buildRequest(prompt, { size: YINGHUA_SIZE, imageOverride }),
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

      {/* Reference thumbnails — click to enlarge */}
      <div className="mb-3 flex gap-2 overflow-hidden rounded-lg border border-zzz-text/10 p-2">
        <div className="flex-1 cursor-pointer" onClick={() => { setLightboxSrc(`/作者推荐/${current.label}.png`); setLightbox(true); }}>
          <img
            src={`/作者推荐/${current.label}.png`}
            alt={`${current.label} 示例1`}
            className="mx-auto max-w-xs w-full"
            loading="lazy"
          />
          <p className="text-center font-mono text-[10px] text-zzz-text/45">参考图1 · 点击放大</p>
        </div>
        {current.id === 'surprise' && (
          <div className="flex-1 cursor-pointer" onClick={() => { setLightboxSrc(`/作者推荐/${current.label}_thumb.png`); setLightbox(true); }}>
            <img
              src={`/作者推荐/${current.label}_thumb.png`}
              alt={`${current.label} 示例2`}
              className="mx-auto max-w-xs w-full"
              loading="lazy"
            />
            <p className="text-center font-mono text-[10px] text-zzz-text/45">参考图2 · 点击放大</p>
          </div>
        )}
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
            src={lightboxSrc}
            alt={`${current.label} 示例`}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </section>
  );
}
