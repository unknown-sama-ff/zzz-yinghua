import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { YinghuaPanel } from '../../src/components/YinghuaPanel';
import { YinghuaViewer } from '../../src/components/YinghuaViewer';
import { InpaintWorkspace } from '../../src/components/InpaintWorkspace';
import { InpaintTargetSelector } from '../../src/components/InpaintTargetSelector';
import { Toast } from '../../src/components/Toast';
import { useYinghuaStore } from '../../src/store/useYinghuaStore';
import { useInpaintStore } from '../../src/store/useInpaintStore';
import { useViewerStore } from '../../src/store/useViewerStore';
import { useToast } from '../../src/store/useToast';
import { computeClipRegions } from '../../src/lib/clipRegions';
import '../../src/styles/index.css';

// Local synthetic images only. This page is not bundled into production.
const colors = { zero: '#23293d', three: '#9aa4af', yang: '#f1b74e', yin: '#db526b', edited: '#428fce' };
function fixture(name: keyof typeof colors, width = 900, height = 600): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colors[name]; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 64px serif';
  ctx.fillText('HAMAN', 30, 90); ctx.fillText('KARN', width - 260, height - 35);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, width - 24, height - 24);
  ctx.font = '24px monospace'; ctx.fillText(name.toUpperCase() + ' · LOCAL FIXTURE', 40, height / 2);
  return canvas.toDataURL('image/png');
}
const fixtures = Object.fromEntries(Object.keys(colors).map((key) => [key, fixture(key as keyof typeof colors)]));

function TestPage() {
  const [view, setView] = useState<'all' | 'viewer'>('all');
  const [exported, setExported] = useState<{ src: string; name: string } | null>(null);
  useEffect(() => {
    // Observe the real production download action without changing its behavior.
    // Expose the resulting bytes for pixel verification in the local test page.
    const capture = async (event: MouseEvent) => {
      const link = event.target;
      if (!(link instanceof HTMLAnchorElement) || !link.download.startsWith('影画合成-')) return;
      const response = await fetch(link.href);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = () => setExported({ src: String(reader.result), name: link.download });
      reader.readAsDataURL(blob);
    };
    document.addEventListener('click', capture, true);
    return () => document.removeEventListener('click', capture, true);
  }, []);
  const slot = useYinghuaStore((s) => s.yinghuaSlots[3]);
  const sessionOpen = useInpaintStore((s) => s.isWorkspaceOpen);
  const message = useToast((s) => s.message);
  const clear = useToast((s) => s.clear);
  const loadFixtures = () => {
    useYinghuaStore.getState().setYinghuaSlot(1, {status: 'done', images: [fixtures.zero]});
    useYinghuaStore.getState().setYinghuaSlot(2, {status: 'done', images: [fixtures.three]});
    useYinghuaStore.getState().setYinghuaSlot(3, {status: 'done', images: [fixtures.yang, fixtures.yin]});
    useViewerStore.getState().setAllParts(false);
    useViewerStore.getState().setViewerClipRegions(null);
  };
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 text-zzz-text">
      <section className="glass space-y-3 p-4">
        <h1 className="font-mono text-lg">本地回归测试 · 不调用生图接口</h1>
        <div className="flex flex-wrap gap-2">
          <button className="glass-btn px-3 py-2" onClick={loadFixtures}>载入本地样图</button>
          <button className="glass-btn px-3 py-2" onClick={() => setView(view === 'all' ? 'viewer' : 'all')}>{view === 'all' ? '只看 05' : '显示 04'}</button>
          <button className="glass-btn px-3 py-2" onClick={() => useYinghuaStore.getState().setStyle3Face('back')}>切换六命阴</button>
          <button className="glass-btn px-3 py-2" onClick={() => useYinghuaStore.getState().setStyle3Face('front')}>切换六命阳</button>
          <button className="glass-btn px-3 py-2" onClick={() => useYinghuaStore.getState().setYinghuaSlot(3, {images: [fixtures.yang]})}>清空阴图测试回退</button>
          <button className="glass-btn px-3 py-2" onClick={() => useYinghuaStore.getState().setYinghuaSlot(1, {images: [fixture('zero', 1200, 400)]})}>改为 3:1 底图</button>
          <button className="glass-btn px-3 py-2" onClick={() => useViewerStore.getState().setViewerClipRegions(computeClipRegions(.2, .35, -5))}>设置动态裁切</button>
          <button className="glass-btn px-3 py-2" onClick={() => useYinghuaStore.getState().setYinghuaSlot(3, {images: ['/tests/browser/missing-layer.png']})}>测试图层加载失败</button>
        </div>
        <p data-testid="result-state" className="font-mono text-xs">阳图：{slot.images[0] === fixtures.edited ? '已替换' : '原图'} · 阴图：{slot.images[1] === fixtures.edited ? '已替换' : slot.images[1] ? '原图' : '缺失'}</p>
      </section>
      <InpaintTargetSelector>
        {view === 'all' && <YinghuaPanel />}
        <YinghuaViewer />
      </InpaintTargetSelector>
      {exported && (
        <section className="glass space-y-2 p-3">
          <p>真实导出结果：{exported.name}</p>
          <a href={exported.src} download={exported.name} aria-label="保存导出校验文件">保存导出校验文件</a>
          <img src={exported.src} alt="导出 PNG 校验图" className="max-w-full" />
        </section>
      )}
      <InpaintWorkspace />
      {message && <Toast message={message} onClose={clear} />}
      {sessionOpen && (
        <button
          className="glass-btn fixed bottom-24 right-6 z-[100] px-4 py-2 text-zzz-primary"
          onClick={() => useInpaintStore.getState().appendVersion(fixtures.edited, '本地模拟编辑结果')}
        >添加测试编辑版本</button>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><TestPage /></React.StrictMode>);
