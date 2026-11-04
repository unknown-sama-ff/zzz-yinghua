const STORAGE_KEY = 'yinghua:puzzleSounds';
const VOLUME = 0.08;
export type PuzzleSound = 'snap' | 'complete';

export function readPuzzleSoundPreference(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== '0'; } catch { return true; }
}
export function writePuzzleSoundPreference(enabled: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch { /* Sound is usable without storage. */ }
}

/** Brief envelopes avoid clicks; completion replaces the snap instead of stacking over it. */
export function schedulePuzzleSound(context: BaseAudioContext, output: AudioNode, kind: PuzzleSound): void {
  const notes = kind === 'snap'
    ? [{ frequency: 960, end: 580, offset: 0, duration: 0.075, gain: 0.45 }, { frequency: 1440, end: 1050, offset: 0, duration: 0.035, gain: 0.14 }]
    : [{ frequency: 523.25, end: 523.25, offset: 0, duration: 0.15, gain: 0.3 }, { frequency: 659.25, end: 659.25, offset: 0.085, duration: 0.17, gain: 0.3 }, { frequency: 783.99, end: 783.99, offset: 0.17, duration: 0.2, gain: 0.28 }];
  for (const note of notes) {
    const start = context.currentTime + note.offset + 0.003;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(note.end, start + note.duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(note.gain, start + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
    envelope.gain.linearRampToValueAtTime(0, start + note.duration + 0.008);
    oscillator.connect(envelope); envelope.connect(output);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(start); oscillator.stop(start + note.duration + 0.01);
  }
}

export function createPuzzleAudio() {
  let context: AudioContext | null = null;
  let output: GainNode | null = null;
  let enabled = true;
  let disposed = false;
  let lastSnap = -Infinity;
  const unlock = () => {
    if (!enabled || disposed) return;
    try {
      if (!context) {
        if (typeof window === 'undefined' || !window.AudioContext) return;
        context = new window.AudioContext();
        output = context.createGain(); output.gain.value = VOLUME; output.connect(context.destination);
      }
      if (context.state === 'suspended') void context.resume().catch(() => {});
    } catch { /* Audio must never prevent playing the puzzle. */ }
  };
  return {
    unlock,
    setEnabled(value: boolean) {
      enabled = value;
      if (context && output && context.state !== 'closed') output.gain.setTargetAtTime(value ? VOLUME : 0, context.currentTime, 0.01);
    },
    play(kind: PuzzleSound) {
      if (!enabled || disposed) return;
      unlock();
      if (!context || !output || context.state !== 'running') return;
      if (kind === 'snap' && context.currentTime - lastSnap < 0.06) return;
      try { schedulePuzzleSound(context, output, kind); lastSnap = context.currentTime; } catch { /* Unsupported or interrupted audio stays silent. */ }
    },
    dispose() {
      disposed = true;
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    },
  };
}
