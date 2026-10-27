// ─── JSON-parse Worker ────────────────────────────────────────────────────────
//
// Receives a request ID and response Blob, decodes it as UTF-8,
// runs JSON.parse off the main thread, and posts the parsed value back.
//
// This is used by apiClient.generate() to avoid blocking the main thread on
// res.json() for multi-MB responses that embed base64 images.

self.onmessage = async (e: MessageEvent) => {
  const { requestId, blob, buffer } = e.data as { requestId: string; blob?: Blob; buffer?: ArrayBuffer };
  try {
    const text = blob && typeof blob.text === 'function'
      ? await blob.text()
      : new TextDecoder('utf-8', { fatal: false }).decode(buffer);
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
