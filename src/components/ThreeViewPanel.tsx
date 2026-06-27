import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';

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

  const toggle = (
    <label className="flex cursor-pointer select-none items-center gap-2 font-mono text-xs text-zzz-text/70">
      <span className="w-12 text-right">{threeViewEnabled ? '已启用' : '已跳过'}</span>
      <button
        type="button"
        role="switch"
        aria-checked={threeViewEnabled}
        onClick={() => setThreeViewEnabled(!threeViewEnabled)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full px-0.5 transition-colors duration-300 ${
          threeViewEnabled
            ? 'bg-zzz-primary'
            : 'border border-zzz-text/25 bg-zzz-ink/60'
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-zzz-text shadow transition-transform duration-300 ${
            threeViewEnabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );

  return (
    <section className="glass p-6">
      <SectionHeader step="03" title="三视图 + 特写" action={toggle} />

      {threeViewEnabled ? (
        <>
          <textarea
            value={threeViewPrompt}
            onChange={(e) => setThreeViewPrompt(e.target.value)}
            rows={4}
            className="glass-input w-full resize-y px-3 py-2 text-sm leading-relaxed"
          />
          <button
            onClick={() => void run()}
            disabled={threeViewSlot.status === 'loading'}
            data-active="true"
            className="glass-btn mt-3 w-full py-2.5 font-mono text-sm uppercase tracking-widest text-zzz-text"
          >
            生成三视图
          </button>
          <ResultView slot={threeViewSlot} downloadPrefix="three-view" />
        </>
      ) : (
        <p className="font-mono text-xs leading-relaxed text-zzz-text/60">
          此步已跳过。将直接使用上传的立绘进入影画动作设计。
        </p>
      )}
    </section>
  );
}
