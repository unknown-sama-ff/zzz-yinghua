import React from 'react';
import { createRoot } from 'react-dom/client';
import { PuzzleReveal } from '../../src/components/PuzzleReveal';
import '../../src/styles/index.css';
import '../../src/styles/studio.css';
import '../../src/styles/puzzle.css';

const matWidth = Math.min(600, window.innerWidth - 32);
const matHeight = Math.min(700, window.innerHeight - 40);
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <div style={{ position: 'relative', width: matWidth, height: matHeight, margin: '20px auto' }}>
    <PuzzleReveal src='/作者推荐/海报版.webp' galleryId='fixture-error' width={300} height={450} matWidth={matWidth} matHeight={matHeight} roundId='layer-recovery' active disabled={false} onReady={() => {}} />
  </div>
</React.StrictMode>);
