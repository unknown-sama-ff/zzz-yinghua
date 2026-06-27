import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';

/** Section 2.3 — three-view + close-up generation, with an on/off toggle. */
export function ThreeViewPanel() {
  const {
    threeViewEnabled,
    setThreeViewEnabled,
    threeViewPrompt,
    setThreeViewPrompt,
    threeViewSlot,
    setThreeViewSlot,
    uploadedImage,
  } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  const run = async () => {
    if (!uploadedImage) {
      showError('请先上传角色正面图片');
      return;
    }
    setThreeViewSlot({ status: 'loading', error: undefined });
    try {
      const images = await generate(buildRequest(threeViewPrompt));
      setThreeViewSlot({ status: 'done', images });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setThreeViewSlot({ status: 'error', error: msg });
      showError(msg);
    }
  };

  return (
    <section className="zzz-panel zzz-clip p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="zzz-heading text-lg text-zzz-primary">03 · 三视图 + 特写</h2>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-zzz-muted">
          <span>{threeViewEnabled ? '已启用' : '已跳过'}</span>
          <button
            role="switch"
            aria-checked={threeViewEnabled}
            onClick={() => setThreeViewEnabled(!threeViewEnabled)}
            className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${
              threeViewEnabled ? 'bg-zzz-primary' : 'bg-zzz-ink border border-zzz-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-zzz-text transition-transform duration-300 ${
                threeViewEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </div>

      {threeViewEnabled ? (
        <>
          <textarea
            value={threeViewPrompt}
            onChange={(e) => setThreeViewPrompt(e.target.value)}
            rows={4}
            className="w-full resize-y border border-zzz-primary/40 bg-zzz-ink px-3 py-2 text-sm leading-relaxed text-zzz-text outline-none focus:border-zzz-primary"
            style={{ borderRadius: 'var(--zzz-radius)' }}
          />
          <button
            onClick={() => void run()}
            disabled={threeViewSlot.status === 'loading'}
            className="zzz-clip mt-3 w-full border border-zzz-primary bg-zzz-primary/20 py-2 font-mono text-sm uppercase tracking-widest text-zzz-text transition hover:bg-zzz-primary/35 disabled:opacity-50"
          >
            生成三视图
          </button>
          <ResultView slot={threeViewSlot} downloadPrefix="three-view" />
        </>
      ) : (
        <p className="font-mono text-xs leading-relaxed text-zzz-muted">
          此步已跳过。将直接使用上传的立绘进入影画动作设计。
        </p>
      )}
    </section>
  );
}
