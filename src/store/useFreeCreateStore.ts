import { create } from 'zustand';
import type {
  FreeCreateAssistantMessage,
  FreeCreateReference,
  FreeCreateSession,
  FreeCreateUserMessage,
} from '../types';

export interface FreeCreateGeneration {
  sessionId: string;
  userMessageId: string;
}

interface FreeCreateState {
  isOpen: boolean;
  /** Every conversation this page visit has produced, newest last. */
  sessions: FreeCreateSession[];
  activeSessionId: string;
  isGenerating: boolean;
  open: () => void;
  close: () => void;
  newConversation: () => void;
  selectSession: (id: string) => void;
  setDraft: (draft: string) => void;
  addDraftReferences: (references: FreeCreateReference[]) => void;
  removeDraftReference: (id: string) => void;
  selectContextImage: (imageUrl: string) => void;
  setImageCount: (count: number) => void;
  beginGeneration: (prompt: string, references: FreeCreateReference[]) => FreeCreateGeneration | null;
  completeGeneration: (generation: FreeCreateGeneration, images: string[]) => void;
  failGeneration: (generation: FreeCreateGeneration, error: string) => void;
}

function createId(): string {
  return crypto.randomUUID();
}

function createSession(): FreeCreateSession {
  return {
    id: createId(),
    messages: [],
    draft: '',
    draftReferences: [],
    contextImageUrl: null,
    imageCount: 1,
    createdAt: Date.now(),
  };
}

/** Apply a patch to one session, leaving the others untouched. */
function patchSession(
  sessions: FreeCreateSession[],
  id: string,
  patch: (session: FreeCreateSession) => FreeCreateSession,
): FreeCreateSession[] {
  return sessions.map((session) => (session.id === id ? patch(session) : session));
}

export function activeSession(state: {
  sessions: FreeCreateSession[];
  activeSessionId: string;
}): FreeCreateSession {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0];
}

export const useFreeCreateStore = create<FreeCreateState>((set, get) => {
  const initial = createSession();

  return {
    isOpen: false,
    sessions: [initial],
    activeSessionId: initial.id,
    isGenerating: false,

    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),

    // Keep the finished conversation in memory so the user can switch back to it;
    // only a page refresh discards them.
    newConversation: () => {
      const current = activeSession(get());
      if (current && current.messages.length === 0) return;
      const next = createSession();
      set((state) => ({
        sessions: [...state.sessions, next],
        activeSessionId: next.id,
      }));
    },

    selectSession: (id) => {
      if (get().isGenerating) return;
      if (!get().sessions.some((session) => session.id === id)) return;
      set({ activeSessionId: id });
    },

    setDraft: (draft) =>
      set((state) => ({
        sessions: patchSession(state.sessions, state.activeSessionId, (session) => ({ ...session, draft })),
      })),

    addDraftReferences: (references) =>
      set((state) => ({
        sessions: patchSession(state.sessions, state.activeSessionId, (session) => ({
          ...session,
          draftReferences: [...session.draftReferences, ...references],
        })),
      })),

    removeDraftReference: (id) =>
      set((state) => ({
        sessions: patchSession(state.sessions, state.activeSessionId, (session) => ({
          ...session,
          draftReferences: session.draftReferences.filter((reference) => reference.id !== id),
        })),
      })),

    selectContextImage: (contextImageUrl) =>
      set((state) => ({
        sessions: patchSession(state.sessions, state.activeSessionId, (session) => ({
          ...session,
          contextImageUrl,
        })),
      })),

    setImageCount: (count) =>
      set((state) => ({
        sessions: patchSession(state.sessions, state.activeSessionId, (session) => ({
          ...session,
          imageCount: Math.max(1, Math.min(5, Math.round(count))),
        })),
      })),

    beginGeneration: (prompt, references) => {
      const state = get();
      if (state.isGenerating) return null;

      const generation: FreeCreateGeneration = {
        sessionId: state.activeSessionId,
        userMessageId: createId(),
      };
      const message: FreeCreateUserMessage = {
        id: generation.userMessageId,
        role: 'user',
        prompt,
        references,
        status: 'sending',
        createdAt: Date.now(),
      };

      set((current) => ({
        sessions: patchSession(current.sessions, generation.sessionId, (session) => ({
          ...session,
          messages: [...session.messages, message],
          draft: '',
          draftReferences: [],
        })),
        isGenerating: true,
      }));
      return generation;
    },

    completeGeneration: (generation, images) =>
      set((state) => {
        const requestingSession = state.sessions.find((session) => session.id === generation.sessionId);
        const requestingMessage = requestingSession?.messages.find(
          (message) => message.id === generation.userMessageId && message.role === 'user',
        );
        const response: FreeCreateAssistantMessage = {
          id: createId(),
          role: 'assistant',
          images,
          prompt: requestingMessage?.role === 'user' ? requestingMessage.prompt : '',
          createdAt: Date.now(),
        };
        return {
          // Route the result to the session that requested it, even if the user
          // switched conversations while it was in flight.
          sessions: patchSession(state.sessions, generation.sessionId, (session) => ({
            ...session,
            messages: [
              ...session.messages.map((message) =>
                message.id === generation.userMessageId && message.role === 'user'
                  ? { ...message, status: 'complete' as const }
                  : message,
              ),
              response,
            ],
            contextImageUrl: images[0] ?? session.contextImageUrl,
          })),
          isGenerating: false,
        };
      }),

    failGeneration: (generation, error) =>
      set((state) => ({
        sessions: patchSession(state.sessions, generation.sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === generation.userMessageId && message.role === 'user'
              ? { ...message, status: 'error' as const, error }
              : message,
          ),
        })),
        isGenerating: false,
      })),
  };
});
