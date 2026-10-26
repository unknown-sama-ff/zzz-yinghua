import { useFreeCreateStore } from '../store/useFreeCreateStore';
import { useLightboxStore } from '../store/useLightboxStore';
import { useUploadStore } from '../store/useUploadStore';
import { ROUTE_HASHES } from '../lib/navigation';

const examples = [
  { title: '让角色，跳出画框。', kind: '自由版', image: '/作者推荐/自由版.webp', caption: '粗粝印刷 / 自由构图', className: 'exhibit-wide' },
  { title: '把个性印成海报。', kind: '海报版', image: '/作者推荐/海报版.webp', caption: '角色海报 / 视觉叙事', className: 'exhibit-tall' },
  { title: '换一种光，看见角色。', kind: '剪影版', image: '/作者推荐/剪影版.webp', caption: '明暗切片 / 角色轮廓', className: 'exhibit-offset' },
];

const mindscapeExamples = [
  { name: '卡芙卡', image: '/作品示例/kafka-mindscape-cut.webp', preview: '/作品示例/kafka-mindscape-cut-preview.webp', caption: '玫红撞色 / 斜向明暗切片' },
  { name: '流萤', image: '/作品示例/firefly-mindscape-cut.webp', preview: '/作品示例/firefly-mindscape-cut-preview.webp', caption: '黑白对比 / 角色大字排版' },
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
        <p className="hero-description">从一张立绘出发。创作影画命座切割图、设计海报，<br className="hidden sm:block" />或把脑海中的下一幕，变成画面。</p>
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

    <section className="exhibition-capabilities" aria-labelledby="capabilities-title">
      <div className="exhibition-section-heading">
        <div><p className="studio-eyebrow">MINDSCAPE / CHARACTER STUDIES</p><h2 id="capabilities-title">影画命座切割，也能做<span>.</span></h2></div>
        <a href={ROUTE_HASHES.yinghua} className="studio-text-link">开始影画创作 <span aria-hidden="true">↗</span></a>
      </div>
      <p className="capabilities-description">斜向切片、明暗分层、角色大字排版，让你的角色也拥有影画命座般的登场画面。</p>
      <div className="mindscape-examples">
        {mindscapeExamples.map((example) => <figure className="mindscape-example" key={example.name}>
          <button type="button" className="mindscape-image" onClick={() => openImage(example.image, `${example.name} · 影画命座切割示例`)} aria-label={`放大${example.name}影画命座切割示例`}>
            <img src={example.preview} srcSet={`${example.preview} 768w, ${example.image} 1536w`} sizes="(max-width: 600px) calc(100vw - 40px), (max-width: 1400px) calc((100vw - 108px) / 2), 646px" alt={`${example.name}影画命座切割示例，${example.caption.replace(' / ', '、')}`} width="1536" height="1024" loading="lazy" decoding="async" />
            <span className="exhibit-zoom" aria-hidden="true">↗</span>
          </button>
          <figcaption><h3>{example.name} <span>影画命座切割</span></h3><p>{example.caption}</p></figcaption>
        </figure>)}
      </div>
      <div className="character-study">
        <button type="button" className="mindscape-image" onClick={() => openImage('/作品示例/character-three-view.webp', '角色三视图与表情设定示例')} aria-label="放大角色三视图与表情设定示例">
          <img src="/作品示例/character-three-view-preview.webp" srcSet="/作品示例/character-three-view-preview.webp 768w, /作品示例/character-three-view.webp 1536w" sizes="(max-width: 600px) calc(100vw - 40px), (max-width: 1400px) calc((100vw - 108px) / 2), 646px" alt="猫耳角色的正面、侧面、背面三视图，以及面部特写与六种表情设定" width="1536" height="1024" loading="lazy" decoding="async" />
          <span className="exhibit-zoom" aria-hidden="true">↗</span>
        </button>
        <div className="character-study-copy">
          <p className="studio-eyebrow">CHARACTER REFERENCE</p>
          <h3>先认识角色，<br />再让角色登场。</h3>
          <p>正面、侧面、背面，配上面部特写与表情设定。从角色素材到影画创作，为不同画面准备统一的角色参考。</p>
          <a href={ROUTE_HASHES.assets} className="studio-text-link">准备角色素材 <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <p className="capabilities-note">以上为创作效果示例 · 点击图片可放大查看细节</p>
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
