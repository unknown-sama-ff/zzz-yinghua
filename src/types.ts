// Shared types across frontend and the API contract with the Node proxy.

export type ProviderName = 'seedance' | 'gpt-image' | 'custom-url';

/** Request payload the frontend sends to POST /api/generate. */
export interface GenRequest {
  provider: ProviderName;
  prompt: string;
  imageBase64?: string;
  size?: string;
  n?: number;
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

/** One of the three ZZZ yinghua art styles. */
export type YinghuaStyleId = 1 | 2 | 3;

export interface YinghuaStyle {
  id: YinghuaStyleId;
  label: string;
  description: string;
  promptTemplate: string;
}

/** The six independently-toggleable parts of the viewer (2 stages × 3 parts). */
export interface LayerPart {
  /** '01'..'06' */
  code: string;
  stage: 1 | 2;
  /** Image src for this part, if assigned. */
  src?: string;
  visible: boolean;
}

export type GenStatus = 'idle' | 'loading' | 'done' | 'error';

export interface GenSlot {
  status: GenStatus;
  images: string[];
  error?: string;
}
