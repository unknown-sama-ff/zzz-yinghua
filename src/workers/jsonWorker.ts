// ─── JSON-parse Worker ────────────────────────────────────────────────────────
//
// Receives a raw ArrayBuffer (the HTTP response body), decodes it as UTF-8,
// runs JSON.parse off the main thread, and posts the parsed value back.
//
// This is used by apiClient.generate() to avoid blocking the main thread on
// res.json() for multi-MB responses that embed base64 images.

self.onmessage = (e: MessageEvent) => {
  try {
    const buffer = e.data as ArrayBuffer;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const data = JSON.parse(text);
    postMessage({ type: 'result', data });
  } catch (err) {
    postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'json worker parse failed',
    });
  }
};
