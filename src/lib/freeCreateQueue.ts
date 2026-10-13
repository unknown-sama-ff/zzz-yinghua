import { ApiError, generate } from './apiClient';
import { useFreeCreateStore } from '../store/useFreeCreateStore';

const MAX_CONCURRENCY = 2;

interface QueueStore {
  subscribe: (listener: () => void) => () => void;
  getState: () => {
    claimNextGeneration: () => { generation: { sessionId: string; userMessageId: string; attemptId: string }; request: Parameters<typeof generate>[0] } | null;
    completeGeneration: (generation: { sessionId: string; userMessageId: string; attemptId: string }, images: string[]) => void;
    failGeneration: (generation: { sessionId: string; userMessageId: string; attemptId: string }, error: string, failure?: { code?: string; status?: number; uncertain?: boolean }) => void;
  };
}

/** Create a non-persistent queue driver; useful for testing concurrency and failures. */
export function createFreeCreateQueue(store: QueueStore, generateRequest: typeof generate, concurrency = MAX_CONCURRENCY): () => void {
  let active = 0;
  let pumping = false;

  const pump = () => {
    if (pumping) return;
    pumping = true;
    try {
      while (active < concurrency) {
        const claimed = store.getState().claimNextGeneration();
        if (!claimed) break;
        active += 1;
        void generateRequest(claimed.request).then(
          (images) => store.getState().completeGeneration(claimed.generation, images),
          (error) => {
            const apiError = error instanceof ApiError ? error : undefined;
            // A timeout, network loss, or HTTP 200 parse failure leaves the upstream outcome unknown.
            const uncertain = apiError?.status === 200 || apiError?.code === 'UNKNOWN' || apiError?.code === 'UPSTREAM_TIMEOUT';
            store.getState().failGeneration(claimed.generation, apiError?.message ?? '生成失败', { code: apiError?.code, status: apiError?.status, uncertain });
          },
        ).finally(() => {
          active -= 1;
          pump();
        });
      }
    } finally {
      pumping = false;
    }
  };

  const unsubscribe = store.subscribe(pump);
  pump();
  return unsubscribe;
}

let started = false;

/** Start the app-wide queue. It deliberately survives closing the panel. */
export function startFreeCreateQueue(): () => void {
  if (started) return () => undefined;
  started = true;
  createFreeCreateQueue(useFreeCreateStore, generate);
  return () => undefined;
}
