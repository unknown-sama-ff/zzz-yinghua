import { useFreeCreateStore } from '../store/useFreeCreateStore';
import { useLightboxStore } from '../store/useLightboxStore';
import { useUploadStore } from '../store/useUploadStore';
import { ROUTE_HASHES } from '../lib/navigation';

const examples = [
  { title: '让角色，跳出画框。', kind: '自由版', image: '/作者推荐/自由版.webp', caption: '粗粝印刷 / 自由构图', className: 'exhibit-wide' },
  { title: '把个性印成海报。', kind: '海报版', image: '/作者推荐/海报版.webp', caption: '角色海报 / 视觉叙事', className: 'exhibit-tall' },
  { title: '换一种光，看见角色。', kind: '剪影版', image: '/作者推荐/剪影版.webp', caption: '明暗切片 / 角色轮廓', className: 'exhibit-offset' },
];

export function HomePage() {
  const openCreate = useFreeCreateStore((s) => s.open);
  const openImage = useLightboxStore((s) => s.open);
  const palette = useUploadStore((s) => s.palette);

  return <div className="exhibition-home">
    <section className="exhibition-hero" aria-labelledby="home-title">
      <div className="hero-copy">
        <p className="studio-eyebrow"><span /> CHARACTER ART STUDIO</p>
        <h1 id="home-title">影画<span>工坊<span className="hero-period">.</span></span></h1>
        <p className="hero-tagline">让你的角色，有戏可演。</p>
        <p className="hero-description">从一张立绘出发。创作影画、设计海报，<br className="hidden sm:block" />或把脑海中的下一幕，变成画面。</p>
        <div className="hero-actions">
          <button type="button" onClick={openCreate} className="studio-action studio-action-primary">自由创作 <span aria-hidden="true">↗</span></button>
          <a href={ROUTE_HASHES.assets} className="studio-action studio-action-secondary">进入角色工坊 <span aria-hidden="true">→</span></a>
        </div>
        <a className="hero-theme" href={ROUTE_HASHES.assets}>
          <span className="theme-swatches" aria-hidden="true"><i /><i /><i /></span>
          <span>{palette ? '已跟随角色取色' : '上传角色，让工坊染上你的颜色'} <span aria-hidden="true">↗</span></span>
        </a>
      </div>
      <div className="hero-art">
        <div className="hero-art-word" aria-hidden="true">MIND<br />SCAPE</div>
        <div className="hero-art-line" aria-hidden="true" />
        <div className="hero-art-back" aria-hidden="true" />
        <button className="hero-art-main" type="button" onClick={() => openImage('/作者推荐/自由版.webp', '自由版 · 风格示例')} aria-label="放大自由版风格示例">
          <img src="/作者推荐/自由版.webp" alt="黑白与紫色印刷构图的角色影画示例" fetchPriority="high" width="1536" height="1024" />
          <span className="hero-art-label">自由版 / 风格示例 <span aria-hidden="true">↗</span></span>
        </button>
        <button className="hero-art-inset" type="button" onClick={() => openImage('/作者推荐/海报版.webp', '海报版 · 风格示例')} aria-label="放大海报版风格示例">
          <img src="/作者推荐/海报版_thumb.webp" alt="派蒙角色海报示例" width="1024" height="1536" />
          <span>POSTER EDITION</span>
        </button>
        <div className="hero-art-caption"><span>一张立绘，无限种出场方式。</span><span aria-hidden="true">↗</span></div>
      </div>
    </section>

    <section className="exhibition-examples" aria-labelledby="examples-title">
      <div className="exhibition-section-heading">
        <div><p className="studio-eyebrow">MADE IN THE WORKSHOP</p><h2 id="examples-title">画面，不止一面<span>.</span></h2></div>
        <p>工坊风格示例 · 点击作品放大</p>
      </div>
      <div className="exhibition-grid">
        {examples.map((example) => <figure className={`exhibit ${example.className}`} key={example.kind}>
          <button type="button" className="exhibit-image" onClick={() => openImage(example.image, `${example.kind} · 风格示例`)} aria-label={`放大${example.kind}风格示例`}>
            <img src={example.image} alt={`${example.kind}角色创作风格示例`} loading="lazy" />
            <span className="exhibit-label">{example.kind} / 风格示例</span><span className="exhibit-zoom" aria-hidden="true">↗</span>
          </button>
          <figcaption><h3>{example.title}</h3><p>{example.caption}</p></figcaption>
        </figure>)}
      </div>
      <div className="exhibition-bottom"><p>下一幅，换你的角色登场。</p><a href={ROUTE_HASHES.gallery} className="studio-text-link">去画廊看看 <span aria-hidden="true">↗</span></a></div>
    </section>
  </div>;
}
