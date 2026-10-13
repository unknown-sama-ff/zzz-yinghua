import { createRoot } from 'react-dom/client';
import { FreeCreateWindow } from '../../src/components/FreeCreateWindow';
import { FreeCreateButton } from '../../src/components/FreeCreateButton';
import { ImageLightbox } from '../../src/components/ImageLightbox';
import { Toast } from '../../src/components/Toast';
import { useFreeCreateStore } from '../../src/store/useFreeCreateStore';
import { useProviderStore } from '../../src/store/useProviderStore';
import { useToast } from '../../src/store/useToast';
import type { GenRequest } from '../../src/types';
import '../../src/styles/index.css';

// Use the production UI and queue, but keep all generation requests local.
// This entry is not included in the production build.
function fixture(label: string, color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 400;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 600, 400);
  ctx.strokeStyle = '#c7bddc'; ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 560, 360);
  ctx.fillStyle = '#eee8f7'; ctx.font = 'bold 32px sans-serif';
  ctx.fillText(label, 40, 70);
  ctx.font = '18px sans-serif'; ctx.fillText('本地样图 · 无费用', 40, 350);
  for (let index = 0; index < 3; index++) {
    const x = 150 + index * 150;
    ctx.beginPath(); ctx.arc(x, 150, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 16, 178, 32, 74);
    ctx.fillRect(x - 17, 250, 10, 44); ctx.fillRect(x + 8, 250, 10, 44);
  }
  return canvas.toDataURL('image/png');
}

const fixtures = {
  character: fixture('角色三视图 A', '#433059'),
  scene: fixture('婚礼背景', '#394551'),
  targetA: fixture('目标画面 A', '#294d52'),
  targetB: fixture('目标画面 B', '#644344'),
  targetC: fixture('角色三视图 B', '#554d31'),
};
const requests: GenRequest[] = [];
const responses = new Map<string, { ok: boolean; images?: string[]; code?: string; message?: string }>();
const failedInputs = new Set<string>();
let current = 0;
let maxConcurrent = 0;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith('/api/generate')) return realFetch(input, init);
  const body = JSON.parse(String(init?.body)) as GenRequest;
  requests.push(body);
  current++; maxConcurrent = Math.max(maxConcurrent, current);
  await new Promise((resolve) => setTimeout(resolve, body.prompt.includes('慢') ? 2800 : 1500));
  const identity = body.idempotencyKey ?? crypto.randomUUID();
  let response = responses.get(identity);
  if (!response) {
    const inputIdentity = `${body.imageBase64?.slice(-120)}|${body.prompt}`;
    if (body.prompt.includes('首次失败') && !failedInputs.has(inputIdentity)) {
      failedInputs.add(inputIdentity);
      response = { ok: false, code: 'UPSTREAM_ERROR', message: 'gpt-image 图像编辑返回 400（本地模拟）' };
    } else {
      response = { ok: true, images: Array.from({ length: body.n ?? 1 }, (_, index) => fixture(`创作结果 ${requests.length}-${index + 1}`, '#3c4365')) };
    }
    responses.set(identity, response);
  }
  current--;
  return new Response(JSON.stringify(response), { status: response.ok ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
};

useProviderStore.getState().setCred('gpt-image', { apiKey: 'local-test-only', baseUrl: 'https://local-test.invalid/v1', model: 'gpt-image-2.5-sunburst' });
useProviderStore.getState().setProvider('gpt-image');

function loadCharacterBatch() {
  const state = useFreeCreateStore.getState();
  state.newConversation();
  const id = useFreeCreateStore.getState().activeSessionId;
  useFreeCreateStore.getState().setMode('fixed-character', id);
  useFreeCreateStore.getState().setSharedReference({ id: 'character', name: '角色三视图 A.png', dataUrl: fixtures.character }, id);
  useFreeCreateStore.getState().addBatchReferences([
    { id: crypto.randomUUID(), name: '目标画面 A.png', dataUrl: fixtures.targetA },
    { id: crypto.randomUUID(), name: '目标画面 B.png', dataUrl: fixtures.targetB },
  ], id);
  useFreeCreateStore.getState().setDraft('用共用三视图替换目标中的人物，保留动作与背景。首次失败', id);
  useFreeCreateStore.getState().open();
}

function loadSceneBatch() {
  useFreeCreateStore.getState().newConversation();
  const id = useFreeCreateStore.getState().activeSessionId;
  useFreeCreateStore.getState().setMode('fixed-scene', id);
  useFreeCreateStore.getState().setSharedReference({ id: 'scene', name: '婚礼背景.png', dataUrl: fixtures.scene }, id);
  useFreeCreateStore.getState().addBatchReferences([
    { id: crypto.randomUUID(), name: '角色 A.png', dataUrl: fixtures.character },
    { id: crypto.randomUUID(), name: '角色 B.png', dataUrl: fixtures.targetC },
  ], id);
  useFreeCreateStore.getState().setDraft('保持婚礼背景，逐个放入角色，每项生成一张。', id);
  useFreeCreateStore.getState().open();
}

declare global {
  interface Window {
    __freeCreateTest: {
      store: typeof useFreeCreateStore;
      requests: GenRequest[];
      fixtures: typeof fixtures;
      maxConcurrent: () => number;
      loadCharacterBatch: () => void;
      loadSceneBatch: () => void;
    };
  }
}
window.__freeCreateTest = { store: useFreeCreateStore, requests, fixtures, maxConcurrent: () => maxConcurrent, loadCharacterBatch, loadSceneBatch };

function TestPage() {
  const message = useToast((state) => state.message);
  const clear = useToast((state) => state.clear);
  return <>
    <main className="mx-auto max-w-5xl space-y-4 p-6 text-zzz-text">
      <h1 className="zzz-heading text-2xl">自由创作本地演示</h1>
      <p className="font-mono text-sm text-zzz-text/70">使用实际工作台与任务队列，结果为本地样图，不调用生图接口。</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={loadCharacterBatch} className="glass-btn px-4 py-2">载入角色批量样图</button>
        <button type="button" onClick={loadSceneBatch} className="glass-btn px-4 py-2">载入背景批量样图</button>
      </div>
      <p className="font-mono text-xs text-zzz-text/60">提示词包含“首次失败”时，该输入第一次会模拟 400，用于验证原位重试。</p>
    </main>
    <FreeCreateButton /><FreeCreateWindow /><ImageLightbox />
    {message && <Toast message={message} onClose={clear} />}
  </>;
}

loadCharacterBatch();
createRoot(document.getElementById('root')!).render(<TestPage />);
