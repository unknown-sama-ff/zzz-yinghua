// Shared types across frontend and the API contract with the Node proxy.

export type ProviderName = 'seedream' | 'gpt-image' | 'custom-url';

/** Request payload the frontend sends to POST /api/generate. */
export interface GenRequest {
  provider: ProviderName;
  prompt: string;
  imageBase64?: string;
  imageMime?: string;
  /** Multiple independent reference images for GPT image-edit workflows. */
  refImages?: { base64: string; mime: string }[];
  /** Maximum long edge for all image-edit inputs; the server clamps this to safe presets. */
  inputImageMaxDimension?: number;
  size?: string;
  aspectRatio?: string;
  n?: number;
  useServerPreset?: boolean;
  // Optional per-request credentials (override server .env when provided).
  // Kept in memory only on the client; never persisted.
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  // custom-url only:
  customEndpoint?: string;
  customHeaders?: Record<string, string>;
  customBodyTemplate?: string;
  /** Opaque token that coalesces retries of one logical generation. */
  idempotencyKey?: string;
  /** Free-creation chat turns carry their own input-image ceiling, not the model table's. */
  freeCreate?: boolean;
}

/** Normalized successful result. `images` are URLs or data URIs. */
export interface GenResult {
  images: string[];
  raw?: unknown;
}

/** Unified API envelope returned by the proxy. */
export type ApiResponse =
  | { ok: true; images: string[]; taskId?: string; raw?: unknown }
  | { ok: false; code: ApiErrorCode; message: string };

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED'
  | 'SSRF_BLOCKED'
  | 'PAYMENT_NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export interface FreeCreateReference {
  id: string;
  dataUrl: string;
  name: string;
}

export interface FreeCreateUserMessage {
  id: string;
  role: 'user';
  prompt: string;
  references: FreeCreateReference[];
  status: 'sending' | 'complete' | 'error';
  error?: string;
  createdAt: number;
}

export interface FreeCreateAssistantMessage {
  id: string;
  role: 'assistant';
  images: string[];
  /** The user instruction that produced these images — carried for gallery saves. */
  prompt: string;
  createdAt: number;
}

export type FreeCreateMessage = FreeCreateUserMessage | FreeCreateAssistantMessage;

/** One free-creation conversation. Lives in memory only; a page refresh clears it. */
export interface FreeCreateSession {
  id: string;
  messages: FreeCreateMessage[];
  draft: string;
  draftReferences: FreeCreateReference[];
  contextImageUrl: string | null;
  /** How many images the next turn should generate (1–5). Sticky across turns. */
  imageCount: number;
  /** Output ratio for the next turn (e.g. '1:1', '16:9'). Sticky across turns. */
  aspectRatio: string;
  createdAt: number;
}

/** A semantic palette extracted from the uploaded image. */
export interface Palette {
  dominant: string;
  accent: string;
  muted: string;
  /** '#000' or '#fff', whichever reads better on `dominant`. */
  textOn: string;
  /** Near-black print tone for TOP text (background darkened). */
  textTop: string;
  /** Brightened dominant for BOTTOM text. */
  textBottom: string;
  /** Extra-brightened dominant for TOP text in 六命 (distinct from BOTTOM). */
  textTopBright: string;
}

/** Name text placement mode for viewer overlay and AI prompt sync. */
export type NamePlacement = 'auto' | 'top-left+bottom-right' | 'top-right+bottom-left';

/** One of the three ZZZ yinghua art styles. */
export type YinghuaStyleId = 1 | 2 | 3;

/** A displayed image that can be opened in the local continuous editing workspace. */
export type InpaintTargetType = 'yinghua' | 'poster' | 'costume' | 'three-view' | 'upload' | 'preview';

/** One image version in the current browser-only editing session. */
export interface ImageEditVersion {
  id: string;
  /** `null` identifies the original module image opened into the session. */
  parentId: string | null;
  url: string;
  /** The user instruction that produced this version; absent on the original. */
  instruction: string | null;
  createdAt: number;
}

/**
 * Identifies both the source image shown on the canvas and, when possible, the
 * exact module slot that a confirmed inpaint result may replace.
 */
export interface InpaintTarget {
  url: string;
  type: InpaintTargetType;
  /** Yinghua style ID for `type: 'yinghua'`. */
  slotId?: YinghuaStyleId;
  /** Image index within the module slot (six-fate: 0 = 阳, 1 = 阴). */
  index?: number;
}

export interface YinghuaStyle {
  id: YinghuaStyleId;
  label: string;
  description: string;
  promptTemplate: string;
  promptTemplateEn?: string;
  promptTemplateFront?: string;
  promptTemplateFrontEn?: string;
  promptTemplateBack?: string;
  promptTemplateBackEn?: string;
}

/**
 * One of the six independently-toggleable parts of the viewer.
 * Mechanic (mirrors 六种样式/0~6.png): 零命 (style 1) is the always-on base layer.
 * 三命 (style 2) overlays on top, diagonally split into 3 regions → buttons 01-03.
 * 六命 (style 3) overlays above that, split into 3 regions → buttons 04-06.
 * Toggling a button reveals that diagonal region of the higher-tier image,
 * progressively building from 零命 up to 六命.
 */
export interface LayerPart {
  /** '01'..'06' */
  code: string;
  /** Which stage group in the control bar (1 = buttons 01-03, 2 = 04-06). */
  stage: 1 | 2;
  /** Which generated image tier this part draws from (2 = 三命, 3 = 六命). */
  styleId: 2 | 3;
  /** Diagonal region index within that tier's image (0,1,2 = top→bottom band). */
  region: 0 | 1 | 2;
  visible: boolean;
}

export type GenStatus = 'idle' | 'loading' | 'done' | 'error';

export interface GenSlot {
  status: GenStatus;
  images: string[];
  error?: string;
}

/** Canvas API exposed via window.__inpaintCanvas for InpaintWorkspace. */
export interface InpaintCanvasAPI {
  applyFeather: () => void;
  exportMask: () => string | null;
  getMaskBlobUrl: () => string | null;
  undo: () => void;
  clearMask: () => void;
}

declare global {
  interface Window {
    __inpaintCanvas?: InpaintCanvasAPI;
  }
}
