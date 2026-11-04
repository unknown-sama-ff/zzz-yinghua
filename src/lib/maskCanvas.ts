type MaskPatch = Uint8Array | null;
type Stroke = { patches: Map<number, MaskPatch>; occupied: Set<number>; bytes: number };

/** Alpha-only undo patches. Empty tiles need no snapshot; reads stay within touched tiles. */
export class MaskHistory {
  private readonly tileSize = 128;
  private readonly budget = 32 * 1024 * 1024;
  private occupied = new Set<number>();
  private history: Stroke[] = [];
  private pending: Stroke | null = null;
  private bytes = 0;
  private overflow = false;
  constructor(private canvas: HTMLCanvasElement) {}
  get hasContent() { return this.occupied.size > 0; }
  reset() { this.occupied.clear(); this.history = []; this.pending = null; this.bytes = 0; }
  begin() { this.pending = { patches: new Map(), occupied: new Set(this.occupied), bytes: 0 }; this.overflow = false; }
  private tiles(x1: number, y1: number, x2: number, y2: number, visit: (key: number, x: number, y: number, w: number, h: number) => void) {
    const size = this.tileSize, cols = Math.ceil(this.canvas.width / size);
    const left = Math.max(0, Math.floor(Math.min(x1, x2) / size)), top = Math.max(0, Math.floor(Math.min(y1, y2) / size));
    const right = Math.min(cols - 1, Math.floor(Math.max(x1, x2) / size)), bottom = Math.min(Math.ceil(this.canvas.height / size) - 1, Math.floor(Math.max(y1, y2) / size));
    for (let ty = top; ty <= bottom; ty++) for (let tx = left; tx <= right; tx++) {
      const x = tx * size, y = ty * size; visit(ty * cols + tx, x, y, Math.min(size, this.canvas.width - x), Math.min(size, this.canvas.height - y));
    }
  }
  capture(x1: number, y1: number, x2: number, y2: number) {
    const ctx = this.canvas.getContext('2d')!;
    this.tiles(x1, y1, x2, y2, (key, x, y, w, h) => {
      if (!this.pending || this.overflow || this.pending.patches.has(key)) return;
      if (!this.pending.occupied.has(key)) { this.pending.patches.set(key, null); return; }
      const bytes = w * h;
      if (this.pending.bytes + bytes > this.budget) { this.overflow = true; this.pending.patches.clear(); this.pending.bytes = 0; return; }
      // Budget the live stroke together with saved patches, not just at commit.
      while (this.history.length && this.bytes + this.pending.bytes + bytes > this.budget) this.bytes -= this.history.shift()!.bytes;
      const rgba = ctx.getImageData(x, y, w, h).data, alpha = new Uint8Array(bytes);
      for (let i = 0; i < bytes; i++) alpha[i] = rgba[i * 4 + 3];
      this.pending.patches.set(key, alpha); this.pending.bytes += bytes;
    });
  }
  update(x1: number, y1: number, x2: number, y2: number) {
    const ctx = this.canvas.getContext('2d')!;
    this.tiles(x1, y1, x2, y2, (key, x, y, w, h) => {
      const data = ctx.getImageData(x, y, w, h).data;
      let content = false;
      for (let i = 3; i < data.length; i += 4) if (data[i]) { content = true; break; }
      if (content) this.occupied.add(key); else this.occupied.delete(key);
    });
  }
  commit() {
    if (this.overflow) { this.history = []; this.bytes = 0; }
    else if (this.pending?.patches.size) {
      this.history.push(this.pending); this.bytes += this.pending.bytes;
      while (this.history.length > 20 || this.bytes > this.budget) this.bytes -= this.history.shift()!.bytes;
    }
    this.pending = null;
  }
  undo() {
    const prev = this.history.pop(); if (!prev) return false;
    const ctx = this.canvas.getContext('2d')!, cols = Math.ceil(this.canvas.width / this.tileSize);
    for (const [key, alpha] of prev.patches) {
      const x = (key % cols) * this.tileSize, y = Math.floor(key / cols) * this.tileSize;
      const w = Math.min(this.tileSize, this.canvas.width - x), h = Math.min(this.tileSize, this.canvas.height - y);
      if (alpha === null) ctx.clearRect(x, y, w, h);
      else {
        const pixels = ctx.createImageData(w, h); pixels.data.fill(255);
        for (let i = 0; i < alpha.length; i++) pixels.data[i * 4 + 3] = alpha[i];
        ctx.putImageData(pixels, x, y);
      }
    }
    this.occupied = prev.occupied; this.bytes -= prev.bytes; return true;
  }
}
