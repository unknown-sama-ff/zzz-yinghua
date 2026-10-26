import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useUploadStore } from './store/useUploadStore';
import { useIdentityStore } from './store/useIdentityStore';
import { useInpaintStore } from './store/useInpaintStore';
import { useViewerStore } from './store/useViewerStore';
import { useToast } from './store/useToast';
import { applyTheme } from './lib/theme';
import { isWorkshopRoute, routeFromHash, ROUTE_HASHES, type AppRoute } from './lib/navigation';
import { useCursorEffectsPref } from './lib/useCursorEffectsPref';
import { HomePage } from './components/HomePage';
import { StudioHeader, StudioFooter, StudioOverlays } from './components/StudioChrome';
import { InpaintWorkspace } from './components/InpaintWorkspace';
import { FloatingInpaintButton } from './components/FloatingInpaintButton';
import { FreeCreateWindow } from './components/FreeCreateWindow';
import { InpaintTargetSelector } from './components/InpaintTargetSelector';
import { Toast } from './components/Toast';
import { ImageLightbox } from './components/ImageLightbox';
import { CursorEffects } from './components/CursorEffects';
import { AmbientPetals } from './components/AmbientPetals';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/studio.css';

const Assets = lazy(() => import('./components/CharacterAssets'));
const YinghuaPanel = lazy(() => import('./components/YinghuaPanel').then((m) => ({ default: m.YinghuaPanel })));
const YinghuaViewer = lazy(() => import('./components/YinghuaViewer').then((m) => ({ default: m.YinghuaViewer })));
const Poster = lazy(() => import('./components/PosterPanel').then((m) => ({ default: m.PosterPanel })));
const Gallery = lazy(() => import('./components/GalleryPanel').then((m) => ({ default: m.GalleryPanel })));
const Prompts = lazy(() => import('./components/PromptGalleryPanel').then((m) => ({ default: m.PromptGalleryPanel })));

const workshopTabs = [{ route: 'assets', label: '角色素材' }, { route: 'yinghua', label: '影画创作' }, { route: 'poster', label: '海报创作' }] as const;
const pageTitles: Record<AppRoute, string> = { home: '影画工坊 · 让你的角色，有戏可演', assets: '角色素材 · 影画工坊', yinghua: '影画创作 · 影画工坊', poster: '海报创作 · 影画工坊', gallery: '画廊 · 影画工坊', prompts: '提示词 · 影画工坊' };

/** Mount on first visit; native hidden removes inactive content from layout and focus. */
function KeepPage({ active, children, name }: { active: boolean; children: ReactNode; name: string }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!visited && !active) return null;
  return <section className="studio-page" hidden={!active} aria-label={name}>
    <ErrorBoundary><Suspense fallback={<p className="studio-loading" role="status">正在打开{name}…</p>}>{children}</Suspense></ErrorBoundary>
  </section>;
}

export default function App() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const previousRoute = useRef(route);
  const palette = useUploadStore((s) => s.palette);
  const uploadedImage = useUploadStore((s) => s.uploadedImage);
  const characterName = useIdentityStore((s) => s.characterName);
  const workspaceOpen = useInpaintStore((s) => s.isWorkspaceOpen);
  const viewerFullscreen = useViewerStore((s) => s.viewerFullscreen);
  const { message, clear } = useToast();
  const effects = useCursorEffectsPref();

  useLayoutEffect(() => { applyTheme(palette); }, [palette]);
  useEffect(() => {
    const updateRoute = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);
  useEffect(() => {
    document.title = pageTitles[route];
    if (window.location.hash !== ROUTE_HASHES[route]) window.history.replaceState(null, '', ROUTE_HASHES[route]);
    if (previousRoute.current !== route) {
      useInpaintStore.getState().setIsSelecting(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
      main.current?.focus({ preventScroll: true });
    }
    previousRoute.current = route;
  }, [route]);

  return <div className="ambient-scene studio-app" onClick={(event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor?.getAttribute('href') === ROUTE_HASHES[route]) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'instant' });
      main.current?.focus({ preventScroll: true });
    }
  }}>
    {effects.enabled && <AmbientPetals />}
    <div className="ambient-scene__content">
      <CursorEffects enabled={effects.enabled} reduced={effects.reduced} />
      <a href="#studio-main" className="studio-skip-link" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>跳到主要内容</a>
      <StudioHeader route={route} onSettings={() => setSettingsOpen(true)} />
      <main id="studio-main" tabIndex={-1} ref={main} className="studio-main">
        {route === 'home' && <HomePage />}
        {isWorkshopRoute(route) && <header className="workshop-heading">
          <div><p className="studio-eyebrow">CHARACTER WORKSHOP</p><h1>角色工坊<span>.</span></h1><p>准备角色素材，选择一种出场方式。</p></div>
          <div className="workshop-character">{uploadedImage ? <img src={uploadedImage} alt="当前角色" /> : <span aria-hidden="true">↗</span>}<div><strong>{uploadedImage ? characterName || '当前角色' : '还没有角色素材'}</strong><span>{uploadedImage ? '主题已跟随当前立绘' : '先上传立绘，或生成三视图'}</span></div></div>
          <nav aria-label="角色工坊分区" className="workshop-tabs">{workshopTabs.map((tab) => <a key={tab.route} href={ROUTE_HASHES[tab.route]} aria-current={route === tab.route ? 'page' : undefined}>{tab.label}<span aria-hidden="true">↗</span></a>)}</nav>
        </header>}
        <InpaintTargetSelector showEditButton={false}>
          <KeepPage active={route === 'assets'} name="角色素材"><Assets /></KeepPage>
          <KeepPage active={route === 'yinghua'} name="影画创作">
            {!uploadedImage && <p className="studio-notice">先<a href={ROUTE_HASHES.assets}>准备角色素材 ↗</a>，再开始生成影画。</p>}
            <YinghuaPanel /><YinghuaViewer />
          </KeepPage>
          <KeepPage active={route === 'poster'} name="海报创作"><Poster /></KeepPage>
          <KeepPage active={route === 'gallery'} name="画廊"><div className="studio-page-intro"><p className="studio-eyebrow">THE COMMUNITY COLLECTION</p><h1>在这里，让作品相遇<span>.</span></h1><p>浏览大家保存的生成作品，找到下一次创作的灵感。</p></div><Gallery /></KeepPage>
          <KeepPage active={route === 'prompts'} name="提示词"><Prompts /></KeepPage>
        </InpaintTargetSelector>
      </main>
      <StudioFooter onSupport={() => setSupportOpen(true)} />
      <StudioOverlays settingsOpen={settingsOpen} onSettingsClose={() => setSettingsOpen(false)} supportOpen={supportOpen} onSupportClose={() => setSupportOpen(false)} effects={effects} />
      <FreeCreateWindow />
      {(isWorkshopRoute(route) || route === 'gallery') && !workspaceOpen && !viewerFullscreen && <FloatingInpaintButton />}
      <InpaintWorkspace />
      <ImageLightbox />
      {message && <Toast message={message} onClose={clear} />}
    </div>
  </div>;
}
