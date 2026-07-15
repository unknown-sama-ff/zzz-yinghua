import { useStore } from './store/useStore';
import { useToast } from './store/useToast';
import { Uploader } from './components/Uploader';
import { ProviderSelect } from './components/ProviderSelect';
import { ThreeViewPanel } from './components/ThreeViewPanel';
import { YinghuaPanel } from './components/YinghuaPanel';
import { YinghuaViewer } from './components/YinghuaViewer';
import { PosterPanel } from './components/PosterPanel';
import { InpaintWorkspace } from './components/InpaintWorkspace';
import { FloatingInpaintButton } from './components/FloatingInpaintButton';
import { InpaintTargetSelector } from './components/InpaintTargetSelector';
import { Toast } from './components/Toast';
import { CursorEffects } from './components/CursorEffects';
import { lazy, Suspense } from 'react';

export default function App() {
  const palette = useStore((s) => s.palette);
  const { message, clear } = useToast();

  return (
    <div className="min-h-full">
      <CursorEffects />

      {/* Header */}
      <header className="relative overflow-hidden px-6 py-8">
        <div
          className="pointer-events-none absolute -right-24 top-0 h-full w-2/3"
          style={{
            background:
              'radial-gradient(60% 120% at 100% 0%, color-mix(in srgb, var(--zzz-primary) 20%, transparent), transparent 70%)',
          }}
        />

        <div className="mx-auto max-w-6xl">
          <h1 className="zzz-heading text-4xl tracking-widest text-zzz-text sm:text-5xl">
            影画<span className="text-zzz-primary">工坊</span>
            <span className="ml-3 align-middle font-mono text-sm tracking-[0.3em] text-zzz-magenta">
              YINGHUA WORKSHOP
            </span>
          </h1>
          <p className="mt-2 font-mono text-xs text-zzz-text/55">
            补全三视图 → 上传立绘 → 生成影画三风格 → ZZZ 风格图层查看器
            {palette && <span className="ml-2 text-zzz-cyan">// 主题已跟随立绘取色</span>}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 pb-10">
        {/* Step 01: three-view generation workbench — first. */}
        <ThreeViewPanel />

        {/* Setup row: upload + provider side by side. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Uploader />
          <ProviderSelect />
        </div>

        {/* Generation steps, full width, stacked in order. */}
        <InpaintTargetSelector>
          <YinghuaPanel />
          <YinghuaViewer />
          <PosterPanel />
          <Suspense fallback={
            <div className="mt-3 flex h-48 animate-pulse items-center justify-center rounded-xl border border-zzz-text/10 bg-zzz-text/[0.03]">
              <span className="font-mono text-xs tracking-widest text-zzz-primary">LOADING…</span>
            </div>
          }>
            <LazyGalleryPanel />
          </Suspense>
        </InpaintTargetSelector>
      </main>

      <FloatingInpaintButton />
      <InpaintWorkspace />

      <footer className="mx-auto max-w-6xl px-6 pb-8 text-center font-mono text-[11px] text-zzz-text/40">
        密钥仅存于服务端 · custom-url 出站经基础 SSRF 校验 · 切换特效程序化复刻
      </footer>

      {message && <Toast message={message} onClose={clear} />}
    </div>
  );
}

const LazyGalleryPanel = lazy(() =>
  import('./components/GalleryPanel').then(m => ({ default: m.GalleryPanel }))
);
