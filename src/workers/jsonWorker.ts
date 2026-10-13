// ─── JSON-parse Worker ────────────────────────────────────────────────────────
//
// Receives a request ID and raw ArrayBuffer (the HTTP response body), decodes it as UTF-8,
// runs JSON.parse off the main thread, and posts the parsed value back.
//
// This is used by apiClient.generate() to avoid blocking the main thread on
// res.json() for multi-MB responses that embed base64 images.

self.onmessage = (e: MessageEvent) => {
  const { requestId, buffer } = e.data as { requestId: string; buffer: ArrayBuffer };
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const data = JSON.parse(text);
    postMessage({ requestId, type: 'result', data });
  } catch (err) {
    postMessage({
      requestId,
      type: 'error',
      message: err instanceof Error ? err.message : 'json worker parse failed',
    });
  }
};
