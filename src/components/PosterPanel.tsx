import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_SIZE, splitName } from '../lib/prompts';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';

const POSTER_TEMPLATE =
  '严格参考并保留上传图片中角色的面部特征、发型发色、服装细节与配色，确保为同一角色、不改变身份特征；在此前提下进行如下风格化：绝区零影画风格，角色动态动作姿势，重墨黑白线稿与大块剪影，高对比明暗，仅以单一「{DOMINANT_COLOR}」色作点缀强调，辅以「{ACCENT_COLOR}」，图片顶部左侧超大做旧印刷体英文「{NAME_TOP}」，图片底部右侧超大做旧印刷体英文「{NAME_BOTTOM}」，角色主体站在画面中央人物脸部清晰不被文字遮挡，底部有一行小字星级副标题信息，斜切几何色块，胶带/贴纸做旧质感，噪点与扫描线，无水印。';

function fillPoster(template: string, name: string, dominant: string, accent: string): string {
  const upper = (name || 'CHARACTER').toUpperCase();
  const [top, bottom] = splitName(upper);
  return template
    .replaceAll('{NAME_TOP}', top)
    .replaceAll('{NAME_BOTTOM}', bottom)
    .replaceAll('{DOMINANT_COLOR}', dominant)
    .replaceAll('{ACCENT_COLOR}', accent);
}

/** Section 06 — one-click ZZZ poster generation, author-recommended prompt. */
export function PosterPanel() {
  const { characterName, uploadedImage, palette, posterSlot, setPosterSlot } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  const dominant = palette?.dominant ?? '#b026ff';
  const accent = palette?.accent ?? '#ff2d9b';
  const prompt = fillPoster(POSTER_TEMPLATE, characterName, dominant, accent);

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
      <SectionHeader step="06" title="作者推荐 · 绝区零风格海报一键生成" />

      <p className="-mt-2 mb-3 font-mono text-[11px] leading-relaxed text-zzz-text/50">
        经典三命影画 + 做旧印刷体英文名排版。角色名和主题色自动从立绘提取，也可在上方修改。点击生成即可获得带文字排版的绝区零风格海报。
      </p>

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

      <ResultView slot={posterSlot} downloadPrefix="zzz-poster" />
    </section>
  );
}
