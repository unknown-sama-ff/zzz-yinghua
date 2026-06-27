import { useStore } from './store/useStore';
import { useToast } from './store/useToast';
import { Uploader } from './components/Uploader';
import { ProviderSelect } from './components/ProviderSelect';
import { ThreeViewPanel } from './components/ThreeViewPanel';
import { YinghuaPanel } from './components/YinghuaPanel';
import { YinghuaViewer } from './components/YinghuaViewer';
import { Toast } from './components/Toast';

export default function App() {
  const palette = useStore((s) => s.palette);
  const { message, clear } = useToast();

  return (
    <div className="min-h-full">
      {/* Header */}
      <header className="relative overflow-hidden border-b border-zzz-primary/30 px-6 py-6">
        <div
          className="pointer-events-none absolute -right-20 top-0 h-full w-1/2"
          style={{
            background: 'linear-gradient(120deg, transparent 50%, color-mix(in srgb, var(--zzz-primary) 25%, transparent) 70%)',
            clipPath: 'polygon(40% 0, 100% 0, 100% 100%, 0 100%)',
          }}
        />
        <h1 className="zzz-heading text-3xl tracking-widest text-zzz-text sm:text-4xl">
          影画<span className="text-zzz-primary">工坊</span>
          <span className="ml-3 font-mono text-sm tracking-[0.3em] text-zzz-magenta">
            YINGHUA WORKSHOP
          </span>
        </h1>
        <p className="mt-1 font-mono text-xs text-zzz-muted">
          上传立绘 → 补全三视图 → 生成影画三风格 → ZZZ 风格图层查看器
          {palette && <span className="ml-2 text-zzz-cyan">// 主题已跟随立绘取色</span>}
        </p>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Uploader />
          <ProviderSelect />
          <ThreeViewPanel />
        </div>
        <div className="space-y-5">
          <YinghuaPanel />
        </div>
        <div className="lg:col-span-2">
          <YinghuaViewer />
        </div>
      </main>

      <footer className="border-t border-zzz-primary/20 p-4 text-center font-mono text-[11px] text-zzz-muted">
        密钥仅存于服务端 · custom-url 出站经基础 SSRF 校验 · 切换特效程序化复刻
      </footer>

      {message && <Toast message={message} onClose={clear} />}
    </div>
  );
}
