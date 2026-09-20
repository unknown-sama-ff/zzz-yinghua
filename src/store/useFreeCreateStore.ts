import { create } from 'zustand';
import type {
  FreeCreateAssistantMessage,
  FreeCreateMessage,
  FreeCreateReference,
  FreeCreateUserMessage,
} from '../types';

export interface FreeCreateGeneration {
  sessionId: string;
  userMessageId: string;
}

interface FreeCreateState {
  isOpen: boolean;
  sessionId: string;
  messages: FreeCreateMessage[];
  draft: string;
  draftReferences: FreeCreateReference[];
  contextImageUrl: string | null;
  isGenerating: boolean;
  open: () => void;
  close: () => void;
  newConversation: () => void;
  setDraft: (draft: string) => void;
  addDraftReferences: (references: FreeCreateReference[]) => void;
  removeDraftReference: (id: string) => void;
  selectContextImage: (imageUrl: string) => void;
  beginGeneration: (prompt: string, references: FreeCreateReference[]) => FreeCreateGeneration | null;
  completeGeneration: (generation: FreeCreateGeneration, images: string[]) => void;
  failGeneration: (generation: FreeCreateGeneration, error: string) => void;
}

function createId(): string {
  return crypto.randomUUID();
}

function createSessionState(isOpen = false) {
  return {
    isOpen,
    sessionId: createId(),
    messages: [] as FreeCreateMessage[],
    draft: '',
    draftReferences: [] as FreeCreateReference[],
    contextImageUrl: null as string | null,
    isGenerating: false,
  };
}

export const useFreeCreateStore = create<FreeCreateState>((set, get) => ({
  ...createSessionState(),

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  newConversation: () => set(createSessionState(get().isOpen)),
  setDraft: (draft) => set({ draft }),
  addDraftReferences: (references) =>
    set((state) => ({ draftReferences: [...state.draftReferences, ...references] })),
  removeDraftReference: (id) =>
    set((state) => ({
      draftReferences: state.draftReferences.filter((reference) => reference.id !== id),
    })),
  selectContextImage: (contextImageUrl) => set({ contextImageUrl }),

  beginGeneration: (prompt, references) => {
    const state = get();
    if (state.isGenerating) return null;

    const generation: FreeCreateGeneration = {
      sessionId: state.sessionId,
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

    set((current) => {
      if (current.sessionId !== generation.sessionId || current.isGenerating) return current;
      return {
        messages: [...current.messages, message],
        draft: '',
        draftReferences: [],
        isGenerating: true,
      };
    });
    return generation;
  },

  completeGeneration: (generation, images) =>
    set((state) => {
      if (state.sessionId !== generation.sessionId) return state;
      const response: FreeCreateAssistantMessage = {
        id: createId(),
        role: 'assistant',
        images,
        createdAt: Date.now(),
      };
      return {
        messages: [
          ...state.messages.map((message) =>
            message.id === generation.userMessageId && message.role === 'user'
              ? { ...message, status: 'complete' as const }
              : message,
          ),
          response,
        ],
        contextImageUrl: images[0] ?? state.contextImageUrl,
        isGenerating: false,
      };
    }),

  failGeneration: (generation, error) =>
    set((state) => {
      if (state.sessionId !== generation.sessionId) return state;
      return {
        messages: state.messages.map((message) =>
          message.id === generation.userMessageId && message.role === 'user'
            ? { ...message, status: 'error' as const, error }
            : message,
        ),
        isGenerating: false,
      };
    }),
}));
