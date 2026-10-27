import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { useInpaintStore } from '../../src/store/useInpaintStore';
import { useYinghuaStore } from '../../src/store/useYinghuaStore';
import { useProviderStore } from '../../src/store/useProviderStore';
import { useUploadStore } from '../../src/store/useUploadStore';
import '../../src/styles/index.css';

// Test-only static imports share the exact module instances used by App,
// including when a developer runs the harness after Vite hot updates.
const harness = {
  configure(source: string) {
    useUploadStore.getState().setUpload(source, 'local-test.png');
    const store = useYinghuaStore.getState();
    store.setZeroFateDraft({ status: 'done', images: [source], context: { sourceImage: source, addonImage: null, prompt: store.zeroFateDraftPrompt } });
    useProviderStore.getState().setCred('gpt-image', { apiKey: 'local-test-key', baseUrl: 'https://example.invalid/v1', model: 'gpt-image-2.5-sunburst' });
  },
  read() {
    const editor = useInpaintStore.getState();
    return { current: editor.currentVersionUrl, root: editor.versions[0]?.id, versions: editor.versions.length,
      generating: editor.isGenerating, target: editor.targetImage, error: editor.generationError,
      draft: useYinghuaStore.getState().zeroFateDraft.images[0], slots: useYinghuaStore.getState().yinghuaSlots };
  },
  loadSix(sources: { original: string; yang: string; yin: string }) {
    const store = useYinghuaStore.getState();
    store.setYinghuaSlot(1, { status: 'done', images: [sources.original] });
    store.setYinghuaSlot(2, { status: 'done', images: [sources.original] });
    store.setYinghuaSlot(3, { status: 'done', images: [sources.yang, sources.yin] });
  },
};
declare global { interface Window { __legRepairTest: typeof harness } }
window.__legRepairTest = harness;
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
