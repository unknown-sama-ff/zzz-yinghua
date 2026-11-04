import React from 'react';
import { createRoot } from 'react-dom/client';
import { PuzzleReveal } from '../../src/components/PuzzleReveal';
import '../../src/styles/index.css';
import '../../src/styles/studio.css';
import '../../src/styles/puzzle.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <div style={{ position: 'relative', width: 600, height: 700, margin: '20px auto' }}>
    <PuzzleReveal src='/作者推荐/海报版.webp' galleryId='fixture-error' width={300} height={450} matWidth={600} matHeight={700} roundId='layer-recovery' active disabled={false} onReady={() => {}} />
  </div>
</React.StrictMode>);
