import { ROUTE_HASHES } from '../lib/navigation';
import { useLightboxStore } from '../store/useLightboxStore';

export function HomeMemeShowcase() {
  const openImage = useLightboxStore((state) => state.open);
  return <section className="home-memes" aria-labelledby="home-memes-title">
    <div className="exhibition-section-heading">
      <div><p className="studio-eyebrow">CHARACTER / EXPRESSIONS</p><h2 id="home-memes-title">不说话，也有戏<span>.</span></h2></div>
      <a href={ROUTE_HASHES.memes} className="studio-text-link">打开表情包工坊 <span aria-hidden="true">↗</span></a>
    </div>
    <div className="home-meme-exhibit">
      <button type="button" className="home-meme-art" onClick={() => openImage('/作品示例/xingyun-meme-grid.webp', '星云 · 九款无字表情包')} aria-label="放大星云无字表情包九宫格">
        <img src="/作品示例/xingyun-meme-grid-preview.webp" srcSet="/作品示例/xingyun-meme-grid-preview.webp 900w, /作品示例/xingyun-meme-grid.webp 1536w" sizes="(max-width: 750px) calc(100vw - 40px), (max-width: 1400px) 55vw, 720px" alt="星云角色的九款无字Q版表情包：平静、高冷、思考、得意、骄傲、害羞、惊讶、困惑和慌张" width="1536" height="1536" loading="lazy" decoding="async" />
        <span className="exhibit-zoom" aria-hidden="true">↗</span>
      </button>
      <div className="home-meme-copy">
        <p className="feature-kicker">星云 / 九种心情</p>
        <h3>一个角色，<br />装下好多小情绪。</h3>
        <p>从一点得意，到一脸慌张。让表情和小动作，替角色把心情说出来。</p>
        <ul><li>角色图定身份，参考图定画风</li><li>九宫格或 15 格，有字、无字都能做</li><li>拆成透明 PNG，整套打包带走</li></ul>
        <a href={ROUTE_HASHES.memes} className="studio-action studio-action-primary">制作我的表情包 <span aria-hidden="true">↗</span></a>
        <p className="home-meme-note">无字表情包示例 · 点击九宫格查看细节</p>
      </div>
    </div>
  </section>;
}
