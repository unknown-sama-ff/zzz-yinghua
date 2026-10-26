import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isWorkshopRoute, ROUTE_HASHES, type AppRoute } from '../lib/navigation';
import type { useCursorEffectsPref } from '../lib/useCursorEffectsPref';
import { useFreeCreateStore } from '../store/useFreeCreateStore';
import { useProviderStore } from '../store/useProviderStore';
import { useUploadStore } from '../store/useUploadStore';
import { ProviderSelect } from './ProviderSelect';
import { PaymentPanel } from './PaymentPanel';

function StudioDialog({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="studio-dialog" aria-label={title} onCancel={(event) => {
    event.preventDefault();
    // Let Escape close the nested sponsor list first.
    if (!ref.current?.querySelector('[aria-label="赞助名单"]')) onClose();
  }} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="studio-dialog-content">
      <header><h2>{title}</h2><button type="button" className="studio-icon-button" onClick={onClose} aria-label={`关闭${title}`}>×</button></header>
      {children}
    </div>
  </dialog>;
}

export function StudioHeader({ route, onSettings }: { route: AppRoute; onSettings: () => void }) {
  const openCreate = useFreeCreateStore((s) => s.open);
  const palette = useUploadStore((s) => s.palette);
  const uploadedName = useUploadStore((s) => s.uploadedName);
  return <header className="studio-header">
    <div className="studio-header-inner">
      <a href={ROUTE_HASHES.home} className="studio-brand" aria-label="影画工坊首页"><img className="studio-brand-mark" src="/branding/yinghua-workshop-mark.svg" alt="" width="42" height="45" /><span>影画工坊<small>YINGHUA WORKSHOP</small></span></a>
      <nav className="studio-navigation" aria-label="主导航">
        <a href={ROUTE_HASHES.home} aria-current={route === 'home' ? 'page' : undefined}>首页</a>
        <a href={ROUTE_HASHES.assets} aria-current={isWorkshopRoute(route) ? 'page' : undefined}>角色工坊</a>
        <a href={ROUTE_HASHES.gallery} aria-current={route === 'gallery' ? 'page' : undefined}>画廊</a>
        <a href={ROUTE_HASHES.prompts} aria-current={route === 'prompts' ? 'page' : undefined}>提示词</a>
      </nav>
      <div className="studio-header-actions">
        <a href={ROUTE_HASHES.assets} className="studio-theme-chip" title={uploadedName ?? '上传角色立绘，自动提取主题色'}><span aria-hidden="true" />{palette ? '角色配色' : '默认配色'}</a>
        <button type="button" className="studio-nav-create" onClick={openCreate}>自由创作 <span aria-hidden="true">↗</span></button>
        <button type="button" className="studio-settings-button" onClick={onSettings} aria-label="设置" aria-haspopup="dialog"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--zzz-bg)" /><circle cx="15" cy="17" r="3" fill="var(--zzz-bg)" /></svg><span>设置</span></button>
      </div>
    </div>
  </header>;
}

export function StudioFooter({ onSupport }: { onSupport: () => void }) {
  return <footer className="studio-footer">
    <div><a href={ROUTE_HASHES.home}>影画工坊<span> / YINGHUA WORKSHOP</span></a><p>给每个角色，一个出场的机会。</p></div>
    <div className="studio-footer-links">
      <a href="https://www.bilibili.com/video/BV1r23V6BENS/?vd_source=a22597e544a6473348b3f4a24da47497" target="_blank" rel="noopener noreferrer">Bilibili ↗</a>
      <a href="https://www.douyin.com/user/MS4wLjABAAAA6zJjn2X4oSR1B8c7Py_GH0MtbZcBw9ge4Ka_wgOQDF6h8qaqe3OBTA3SDTlwJT24?from_tab_name=main" target="_blank" rel="noopener noreferrer">抖音 ↗</a>
      <a href="https://github.com/unknown-sama-ff/zzz-yinghua" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      <button type="button" onClick={onSupport} aria-haspopup="dialog">支持工坊 ↗</button>
    </div>
  </footer>;
}

export function StudioOverlays({ settingsOpen, onSettingsClose, supportOpen, onSupportClose, effects }: {
  settingsOpen: boolean; onSettingsClose: () => void; supportOpen: boolean; onSupportClose: () => void;
  effects: ReturnType<typeof useCursorEffectsPref>;
}) {
  const freeloadEnabled = useProviderStore((s) => s.freeloadEnabled);
  const setFreeloadEnabled = useProviderStore((s) => s.setFreeloadEnabled);
  const [settingsVisited, setSettingsVisited] = useState(settingsOpen);
  useEffect(() => { if (settingsOpen) setSettingsVisited(true); }, [settingsOpen]);
  return <>
    <StudioDialog title="工坊设置" open={settingsOpen} onClose={onSettingsClose}>
      {(settingsVisited || settingsOpen) && <>
        <div className="studio-preferences">
          <label><span><strong>使用作者免费通道</strong><small>开启后使用作者预设的图片模型</small></span><input type="checkbox" checked={freeloadEnabled} onChange={(event) => setFreeloadEnabled(event.target.checked)} /></label>
          <label><span><strong>鼠标与落樱特效</strong><small>{effects.reduced ? '已遵循系统的减少动态效果设置' : '保留你的特效偏好，下次访问继续生效'}</small></span><input type="checkbox" checked={effects.storedEnabled} disabled={effects.reduced} onChange={(event) => effects.setEnabled(event.target.checked)} /></label>
        </div>
        <ProviderSelect />
      </>}
    </StudioDialog>
    <StudioDialog title="支持工坊" open={supportOpen} onClose={onSupportClose}>{supportOpen && <PaymentPanel inlineQr />}</StudioDialog>
  </>;
}
