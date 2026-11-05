import { useState } from 'react';
import { ROUTE_HASHES } from '../lib/navigation';
import '../styles/home-features.css';

const modes = ['原画 2D', '悬浮相片', '主体分层'] as const;
const layers = [
  { name: '背景', src: '/作品示例/mermaid-demo-background.webp' },
  { name: '角色与配饰', src: '/作品示例/mermaid-demo-subject.webp' },
  { name: '前景', src: '/作品示例/mermaid-demo-foreground.webp' },
];

export function HomeFeatures() {
  const [mode, setMode] = useState<(typeof modes)[number]>('主体分层');

  return <section className="home-features" aria-labelledby="home-features-title">
    <div className="exhibition-section-heading">
      <div><p className="studio-eyebrow">WORKSHOP / PUZZLE</p><h2 id="home-features-title">美图拼图<span>.</span></h2></div>
      <p>一幅作品，三种观看方式</p>
    </div>
    <div className="feature-exhibit">
      <div className="feature-stage">
        <div className={`feature-portrait ${mode === '主体分层' ? 'is-layered' : mode === '悬浮相片' ? 'is-floating' : 'is-flat'}`}
          onPointerMove={(event) => {
            if (mode !== '主体分层' || event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.style.setProperty('--demo-x', `${((event.clientX - bounds.left) / bounds.width * 2 - 1) * 6}px`);
            event.currentTarget.style.setProperty('--demo-y', `${((event.clientY - bounds.top) / bounds.height * 2 - 1) * 6}px`);
          }}
          onPointerLeave={(event) => {
            event.currentTarget.style.removeProperty('--demo-x');
            event.currentTarget.style.removeProperty('--demo-y');
          }}>
          <div className="feature-portrait-art" role="img" aria-label="晶莹海境中的人鱼乐章，完整呈现长发、鱼尾、薄纱鳍和配饰">
            {mode === '主体分层' ? layers.map((layer) => <img key={layer.name} src={layer.src} alt="" width="941" height="1672" loading="lazy" decoding="async" />)
              : <img src="/作品示例/mermaid-demo-original.webp" alt="" width="941" height="1672" loading="lazy" decoding="async" />}
          </div>
        </div>
        <p className="feature-caption">原图角色像素合成 · 水下背景精修补全</p>
      </div>
      <div className="feature-copy">
        <p className="feature-kicker">MERMAID / LAYER STUDY</p>
        <h3>晶莹海境中的<br />人鱼乐章</h3>
        <p>从画廊轮换挑选美图，选择大、中、小拼块，用鼠标、触屏或键盘自由拼接。完成后放大欣赏，在三种展示模式间切换。</p>
        <div className="feature-mode-block">
          <p className="feature-mode-label">切换展示模式</p>
          <div className="feature-demo-controls" role="group" aria-label="拼图展示模式">
            {modes.map((item) => <button type="button" key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{item}</button>)}
          </div>
          <p className="feature-mode-description">{mode === '主体分层' ? '人鱼、长发、鱼尾、薄纱鳍与配饰整体留在主体层。水面光线和远处音符属于背景，移动鼠标可查看角色与背景的视差。' : mode === '悬浮相片' ? '以悬浮相片的方式欣赏完整画面。' : '平面呈现完整原画。'}</p>
        </div>
        <dl className="feature-layer-guide">
          <div><dt>背景</dt><dd>位于角色后方的海水、光线与环境。</dd></div>
          <div><dt>主体</dt><dd>完整角色、身体部件和随身配饰。</dd></div>
          <div><dt>前景</dt><dd>空间上位于角色前方的独立元素。本图前景层透明。</dd></div>
        </dl>
        <p className="feature-play-note">停留 5 秒或开始移动碎片后准备分层。切换页面保留拼图进度，生图任务继续运行。</p>
        <a className="studio-text-link" href={ROUTE_HASHES.puzzle}>打开美图拼图 <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </section>;
}
