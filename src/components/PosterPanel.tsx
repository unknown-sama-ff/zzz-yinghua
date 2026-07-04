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
];

function fillPoster(template: string, name: string, dominant: string, accent: string): string {
  const upper = (name || 'CHARACTER').toUpperCase();
  const [top, bottom] = splitName(upper);
  return template
    .replaceAll('{NAME_TOP}', top)
    .replaceAll('{NAME_BOTTOM}', bottom)
    .replaceAll('{NAME}', upper)
    .replaceAll('{DOMINANT_COLOR}', dominant)
    .replaceAll('{ACCENT_COLOR}', accent);
}

/** Section 06 — one-click ZZZ poster generation, author-recommended prompt. */
export function PosterPanel() {
  const { characterName, uploadedImage, palette, posterSlot, setPosterSlot, provider } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();
  const [variant, setVariant] = useState<string>(POSTER_VARIANTS[1].id);
  const [lightbox, setLightbox] = useState(false);

  const current = POSTER_VARIANTS.find((v) => v.id === variant) ?? POSTER_VARIANTS[0];
  const dominant = palette?.dominant ?? '#b026ff';
  const accent = palette?.accent ?? '#ff2d9b';
  const prompt = fillPoster(current.template, characterName, dominant, accent);

  const run = async () => {
    if (!uploadedImage) {
      showError('请先上传角色正面图片');
      return;
    }
    setPosterSlot({ status: 'loading', error: undefined });
    try {
      const images = await generate(
        buildRequest(prompt, { size: YINGHUA_SIZE }),
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
