// Shared types across frontend and the API contract with the Node proxy.

export type ProviderName = 'seedance' | 'gpt-image' | 'custom-url';

/** Request payload the frontend sends to POST /api/generate. */
export interface GenRequest {
  provider: ProviderName;
  prompt: string;
  imageBase64?: string;
  imageMime?: string;
  /** Multiple independent reference images (zero-style result, original art, style sheet). */
  refImages?: { base64: string; mime: string }[];
  size?: string;
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
  | 'NOT_FOUND'
  | 'UNKNOWN';

/** A semantic palette extracted from the uploaded image. */
export interface Palette {
  dominant: string;
  accent: string;
  muted: string;
  /** '#000' or '#fff', whichever reads better on `dominant`. */
  textOn: string;
}

/** Name text placement mode for viewer overlay and AI prompt sync. */
export type NamePlacement = 'auto' | 'top-left+bottom-right' | 'top-right+bottom-left';

/** One of the three ZZZ yinghua art styles. */
export type YinghuaStyleId = 1 | 2 | 3;

export interface YinghuaStyle {
  id: YinghuaStyleId;
  label: string;
  description: string;
  promptTemplate: string;
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
