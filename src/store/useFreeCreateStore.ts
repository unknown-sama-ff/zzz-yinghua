import { create } from 'zustand';
import { DEFAULT_FREE_CREATE_ASPECT_RATIO, MAX_FREE_CREATE_IMAGES, MAX_FREE_CREATE_REFERENCES, assertFreeCreateRequestSize } from '../lib/freeCreate';
import type { FreeCreateAssistantMessage, FreeCreateCostumeMode, FreeCreateInputSnapshot, FreeCreateMode, FreeCreateReference, FreeCreateSession, FreeCreateTaskStatus, FreeCreateUserMessage, GenRequest } from '../types';

export interface FreeCreateGeneration {
  sessionId: string;
  userMessageId: string;
  attemptId: string;
}

interface EnqueueInput {
  prompt: string;
  references: FreeCreateReference[];
  request: GenRequest;
  sessionId?: string;
}

interface EnqueueBatchInput {
  prompt: string;
  items: { reference: FreeCreateReference; request: GenRequest }[];
  sessionId?: string;
}

interface GenerationFailure {
  code?: string;
  status?: number;
  uncertain?: boolean;
}

interface FreeCreateState {
  isOpen: boolean;
  sessions: FreeCreateSession[];
  activeSessionId: string;
  /** Compatibility flag; controls no input locks and includes queued tasks. */
  isGenerating: boolean;
  open: () => void;
  close: () => void;
  newConversation: () => void;
  copyConversation: (sessionId?: string) => void;
  selectSession: (id: string) => void;
  setDraft: (draft: string, sessionId?: string) => void;
  addDraftReferences: (references: FreeCreateReference[], sessionId?: string) => void;
  removeDraftReference: (id: string, sessionId?: string) => void;
  addBatchReferences: (references: FreeCreateReference[], sessionId?: string) => void;
  removeBatchReference: (id: string, sessionId?: string) => void;
  setSharedReference: (reference: FreeCreateReference | null, sessionId?: string) => void;
  setMode: (mode: FreeCreateMode, sessionId?: string) => void;
  setCostumeMode: (mode: FreeCreateCostumeMode, sessionId?: string) => void;
  selectContextImage: (imageUrl: string | null, sessionId?: string) => void;
  setImageCount: (count: number, sessionId?: string) => void;
  setAspectRatio: (aspectRatio: string, sessionId?: string) => void;
  restoreDraft: (sessionId: string, messageId: string) => void;
  enqueueGeneration: (input: EnqueueInput) => FreeCreateGeneration | null;
  enqueueBatch: (input: EnqueueBatchInput) => FreeCreateGeneration[];
  retryGeneration: (sessionId: string, messageId: string, confirmUncertain?: boolean) => FreeCreateGeneration | null;
  recheckGeneration: (sessionId: string, messageId: string) => FreeCreateGeneration | null;
  resumeSession: (sessionId: string) => void;
  claimNextGeneration: () => { generation: FreeCreateGeneration; request: GenRequest } | null;
  /** Retained for older callers which run a request directly. */
  beginGeneration: (prompt: string, references: FreeCreateReference[], request?: GenRequest) => FreeCreateGeneration | null;
  completeGeneration: (generation: FreeCreateGeneration, images: string[]) => void;
  failGeneration: (generation: FreeCreateGeneration, error: string, failure?: GenerationFailure) => void;
}

function createId(): string { return crypto.randomUUID(); }
function cloneReference(reference: FreeCreateReference): FreeCreateReference { return { ...reference }; }
function cloneRequest(request: GenRequest): GenRequest {
  return { ...request, ...(request.refImages ? { refImages: request.refImages.map((image) => ({ ...image })) } : {}), ...(request.customHeaders ? { customHeaders: { ...request.customHeaders } } : {}) };
}

function createSession(): FreeCreateSession {
  return { id: createId(), messages: [], draft: '', draftReferences: [], batchReferences: [], sharedReference: null, mode: 'conversation', costumeMode: 'character', contextImageUrl: null, contextRevision: 0, imageCount: 1, aspectRatio: DEFAULT_FREE_CREATE_ASPECT_RATIO, createdAt: Date.now() };
}

function patchSession(sessions: FreeCreateSession[], id: string, patch: (session: FreeCreateSession) => FreeCreateSession): FreeCreateSession[] {
  return sessions.map((session) => session.id === id ? patch(session) : session);
}

export function activeSession(state: { sessions: FreeCreateSession[]; activeSessionId: string }): FreeCreateSession {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0];
}

export function sessionHasPending(session: FreeCreateSession): boolean {
  return session.messages.some((message) => message.role === 'user' && (message.status === 'queued' || message.status === 'sending'));
}

export function sessionStatus(session: FreeCreateSession): 'idle' | 'queued' | 'sending' | 'error' | 'uncertain' | 'paused' {
  if (session.pausedReason) return 'paused';
  for (const status of ['sending', 'queued', 'uncertain', 'error'] as const) {
    if (session.messages.some((message) => message.role === 'user' && message.status === status)) return status;
  }
  return 'idle';
}

function sessionsPatch(sessions: FreeCreateSession[]) {
  return { sessions, isGenerating: sessions.some(sessionHasPending) };
}

function inputSnapshot(session: FreeCreateSession): FreeCreateInputSnapshot {
  return { mode: session.mode, sharedReference: session.sharedReference ? cloneReference(session.sharedReference) : null, contextImageUrl: session.contextImageUrl, contextRevision: session.contextRevision, imageCount: session.imageCount, aspectRatio: session.aspectRatio, costumeMode: session.costumeMode };
}

function createMessage(session: FreeCreateSession, prompt: string, references: FreeCreateReference[], request?: GenRequest, status: FreeCreateTaskStatus = 'queued'): FreeCreateUserMessage {
  const attemptId = createId();
  return { id: createId(), role: 'user', prompt, references: references.map(cloneReference), status, attemptId, inputSnapshot: inputSnapshot(session), ...(request ? { requestSnapshot: { ...cloneRequest(request), idempotencyKey: createId() } } : {}), createdAt: Date.now() };
}

function generationFor(sessionId: string, message: FreeCreateUserMessage): FreeCreateGeneration {
  return { sessionId, userMessageId: message.id, attemptId: message.attemptId };
}

function matchingMessage(session: FreeCreateSession | undefined, generation: FreeCreateGeneration): FreeCreateUserMessage | undefined {
  return session?.messages.find((message): message is FreeCreateUserMessage => message.role === 'user' && message.id === generation.userMessageId && message.attemptId === generation.attemptId && message.status === 'sending');
}

export const useFreeCreateStore = create<FreeCreateState>((set, get) => {
  const initial = createSession();
  function patchInput(sessionId: string | undefined, patch: (session: FreeCreateSession) => FreeCreateSession) {
    set((state) => ({ sessions: patchSession(state.sessions, sessionId ?? state.activeSessionId, patch) }));
  }

  function repeat(sessionId: string, messageId: string, recheck: boolean, confirmUncertain = false): FreeCreateGeneration | null {
    const session = get().sessions.find((item) => item.id === sessionId);
    const message = session?.messages.find((item): item is FreeCreateUserMessage => item.role === 'user' && item.id === messageId);
    if (!session || !message?.requestSnapshot) return null;
    if (recheck ? message.status !== 'uncertain' : message.status !== 'error' && !(message.status === 'uncertain' && confirmUncertain)) return null;
    if (session.mode === 'conversation' && sessionHasPending(session)) return null;
    const repeated: FreeCreateUserMessage = { ...message, status: 'queued', attemptId: createId(), error: undefined, errorCode: undefined, httpStatus: undefined, requestSnapshot: { ...cloneRequest(message.requestSnapshot), idempotencyKey: recheck ? message.requestSnapshot.idempotencyKey : createId() } };
    set((state) => sessionsPatch(patchSession(state.sessions, sessionId, (current) => ({ ...current, messages: current.messages.map((item) => item.id === messageId ? repeated : item) }))));
    return generationFor(sessionId, repeated);
  }

  return {
    isOpen: false,
    sessions: [initial],
    activeSessionId: initial.id,
    isGenerating: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),

    newConversation: () => {
      const next = createSession();
      set((state) => ({ sessions: [...state.sessions, next], activeSessionId: next.id }));
    },
    copyConversation: (sessionId) => {
      const source = get().sessions.find((session) => session.id === (sessionId ?? get().activeSessionId));
      if (!source) return;
      const next = { ...createSession(), draft: source.draft, draftReferences: source.draftReferences.map(cloneReference), batchReferences: source.batchReferences.map(cloneReference), sharedReference: source.sharedReference ? cloneReference(source.sharedReference) : null, mode: source.mode, costumeMode: source.costumeMode, contextImageUrl: source.contextImageUrl, imageCount: source.imageCount, aspectRatio: source.aspectRatio };
      set((state) => ({ sessions: [...state.sessions, next], activeSessionId: next.id }));
    },
    selectSession: (id) => { if (get().sessions.some((session) => session.id === id)) set({ activeSessionId: id }); },
    setDraft: (draft, sessionId) => patchInput(sessionId, (session) => ({ ...session, draft })),
    addDraftReferences: (references, sessionId) => patchInput(sessionId, (session) => ({ ...session, draftReferences: [...session.draftReferences, ...references.map(cloneReference)].slice(0, MAX_FREE_CREATE_REFERENCES) })),
    removeDraftReference: (id, sessionId) => patchInput(sessionId, (session) => ({ ...session, draftReferences: session.draftReferences.filter((reference) => reference.id !== id) })),
    addBatchReferences: (references, sessionId) => patchInput(sessionId, (session) => ({ ...session, batchReferences: [...session.batchReferences, ...references.map(cloneReference)].slice(0, MAX_FREE_CREATE_REFERENCES) })),
    removeBatchReference: (id, sessionId) => patchInput(sessionId, (session) => ({ ...session, batchReferences: session.batchReferences.filter((reference) => reference.id !== id) })),
    setSharedReference: (reference, sessionId) => patchInput(sessionId, (session) => ({ ...session, sharedReference: reference ? cloneReference(reference) : null })),
    setMode: (mode, sessionId) => patchInput(sessionId, (session) => ({ ...session, mode })),
    setCostumeMode: (costumeMode, sessionId) => patchInput(sessionId, (session) => ({ ...session, costumeMode })),
    selectContextImage: (contextImageUrl, sessionId) => patchInput(sessionId, (session) => ({ ...session, contextImageUrl, contextRevision: session.contextRevision + 1 })),
    setImageCount: (count, sessionId) => patchInput(sessionId, (session) => ({ ...session, imageCount: Math.max(1, Math.min(MAX_FREE_CREATE_IMAGES, Math.round(count) || 1)) })),
    setAspectRatio: (aspectRatio, sessionId) => patchInput(sessionId, (session) => ({ ...session, aspectRatio })),

    restoreDraft: (sessionId, messageId) => {
      const message = get().sessions.find((session) => session.id === sessionId)?.messages.find((item): item is FreeCreateUserMessage => item.role === 'user' && item.id === messageId);
      if (!message) return;
      const snapshot = message.inputSnapshot;
      patchInput(sessionId, (session) => ({ ...session, draft: message.prompt, mode: snapshot.mode, costumeMode: snapshot.costumeMode, sharedReference: snapshot.sharedReference ? cloneReference(snapshot.sharedReference) : null, contextImageUrl: snapshot.contextImageUrl, contextRevision: session.contextRevision + 1, imageCount: snapshot.imageCount, aspectRatio: snapshot.aspectRatio, ...(snapshot.mode === 'conversation' ? { draftReferences: message.references.map(cloneReference) } : { batchReferences: message.targetReference ? [cloneReference(message.targetReference)] : [] }) }));
      set({ activeSessionId: sessionId });
    },

    enqueueGeneration: ({ prompt, references, request, sessionId }) => {
      const id = sessionId ?? get().activeSessionId;
      const session = get().sessions.find((item) => item.id === id);
      if (!session || sessionHasPending(session)) return null;
      assertFreeCreateRequestSize(request);
      const message = createMessage(session, prompt, references, request);
      set((state) => sessionsPatch(patchSession(state.sessions, id, (current) => ({ ...current, messages: [...current.messages, message], draft: '', draftReferences: [] }))));
      return generationFor(id, message);
    },
    enqueueBatch: ({ prompt, items, sessionId }) => {
      const id = sessionId ?? get().activeSessionId;
      const session = get().sessions.find((item) => item.id === id);
      if (!session || session.mode === 'conversation' || items.length === 0) return [];
      if (items.length > MAX_FREE_CREATE_REFERENCES) throw new Error(`单批最多支持 ${MAX_FREE_CREATE_REFERENCES} 个任务`);
      for (const item of items) assertFreeCreateRequestSize(item.request);
      const pendingTargetIds = new Set(session.messages.filter((message) => message.role === 'user' && (message.status === 'queued' || message.status === 'sending')).map((message) => message.role === 'user' ? message.targetReference?.id : undefined).filter((id): id is string => Boolean(id)));
      const newItems = items.filter((item) => !pendingTargetIds.has(item.reference.id));
      if (newItems.length === 0) return [];
      const batchId = createId();
      const messages = newItems.map((item, batchIndex) => ({ ...createMessage(session, prompt, session.sharedReference ? [session.sharedReference] : [], { ...item.request, n: 1 }), targetReference: cloneReference(item.reference), batchId, batchIndex }));
      // Batch inputs remain in the composer for the next variations.
      set((state) => sessionsPatch(patchSession(state.sessions, id, (current) => ({ ...current, messages: [...current.messages, ...messages] }))));
      return messages.map((message) => generationFor(id, message));
    },
    retryGeneration: (sessionId, messageId, confirmUncertain) => repeat(sessionId, messageId, false, confirmUncertain),
    recheckGeneration: (sessionId, messageId) => repeat(sessionId, messageId, true),
    resumeSession: (sessionId) => patchInput(sessionId, (session) => ({ ...session, pausedReason: undefined })),

    claimNextGeneration: () => {
      const candidate = get().sessions.flatMap((session) => session.pausedReason ? [] : session.messages.flatMap((message) => message.role === 'user' && message.status === 'queued' && message.requestSnapshot ? [{ session, message }] : [])).sort((a, b) => a.message.createdAt - b.message.createdAt)[0];
      if (!candidate?.message.requestSnapshot) return null;
      const generation = generationFor(candidate.session.id, candidate.message);
      set((state) => sessionsPatch(patchSession(state.sessions, candidate.session.id, (session) => ({ ...session, messages: session.messages.map((message) => message.id === candidate.message.id ? { ...candidate.message, status: 'sending' as const } : message) }))));
      return { generation, request: cloneRequest(candidate.message.requestSnapshot) };
    },
    beginGeneration: (prompt, references, request) => {
      const session = activeSession(get());
      if (sessionHasPending(session)) return null;
      const message = createMessage(session, prompt, references, request, 'sending');
      set((state) => sessionsPatch(patchSession(state.sessions, session.id, (current) => ({ ...current, messages: [...current.messages, message], draft: '', draftReferences: [] }))));
      return generationFor(session.id, message);
    },

    completeGeneration: (generation, images) => {
      const session = get().sessions.find((item) => item.id === generation.sessionId);
      const message = matchingMessage(session, generation);
      if (!session || !message) return;
      if (images.length === 0) {
        get().failGeneration(generation, '服务端未返回图片，请重查原请求', { uncertain: true });
        return;
      }
      const response: FreeCreateAssistantMessage = { id: createId(), role: 'assistant', userMessageId: message.id, images: [...images], prompt: message.prompt, createdAt: Date.now() };
      set((state) => sessionsPatch(patchSession(state.sessions, generation.sessionId, (current) => {
        const canSelectContext = message.inputSnapshot.mode === 'conversation' && current.contextRevision === message.inputSnapshot.contextRevision;
        return { ...current, messages: [...current.messages.map((item) => item.id === message.id ? { ...message, status: 'complete' as const, error: undefined } : item), response], contextImageUrl: canSelectContext ? images[0] : current.contextImageUrl };
      })));
    },
    failGeneration: (generation, error, failure = {}) => {
      const session = get().sessions.find((item) => item.id === generation.sessionId);
      const message = matchingMessage(session, generation);
      if (!message) return;
      const shouldPause = failure.status === 429 || failure.status === 401 || failure.status === 403 || failure.code === 'RATE_LIMITED' || failure.code === 'UNAUTHORIZED';
      set((state) => sessionsPatch(patchSession(state.sessions, generation.sessionId, (current) => ({
        ...current,
        ...(shouldPause ? { pausedReason: error } : {}),
        messages: current.messages.map((item) => item.id === message.id ? {
          ...message,
          // Auth/rate-limit failures are paused before charging a replacement;
          // leave the original request queued for an explicit resume.
          status: shouldPause ? 'queued' as const : failure.uncertain ? 'uncertain' as const : 'error' as const,
          error,
          errorCode: failure.code,
          httpStatus: failure.status,
        } : item),
      }))));
    },
  };
});
