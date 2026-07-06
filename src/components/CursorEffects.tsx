import { useEffect, useLayoutEffect, useRef } from 'react';
import { useCursorEffectsPref } from '../lib/useCursorEffectsPref';
import { useStore } from '../store/useStore';

const THEME_VARS = ['--zzz-primary', '--zzz-magenta', '--zzz-cyan'] as const;
const MAX_PARTICLES = 150;
const MAX_PARTICLES_TOUCH = 80;
const TRAIL_MIN_DIST = 14;
const TRAIL_MIN_DIST_TOUCH = 8;
const SCROLL_PULSE_THROTTLE_MS = 150;
const SCROLL_PULSE_TOUCH_MS = 400;
const SCROLL_PULSE_TOUCH_DIST = 20;
const SPOTLIGHT_RADIUS = 60;
const SPOTLIGHT_RADIUS_TOUCH = 120;
const THEME_REFRESH_INTERVAL_MS = 150;
const THEME_TRANSITION_TAU_MS = 4;
const THEME_TRANSITION_EPSILON = 0.5;

type Particle =
  | { kind: 'trail'; x: number; y: number; r: number; life: number; maxLife: number; color: string }
  | { kind: 'ripple'; x: number; y: number; r: number; maxR: number; life: number; maxLife: number; color: string };

type RGB = { r: number; g: number; b: number };

function parseRgb(color: string): RGB {
  const nums = color.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return { r: 176, g: 38, b: 255 };
  return { r: Number(nums[0]), g: Number(nums[1]), b: Number(nums[2]) };
}

function formatRgb({ r, g, b }: RGB): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Caches the theme colors as interpolated RGB, decoupled from how often the
 * underlying CSS variable is actually sampled. `refreshIfStale` only calls
 * getComputedStyle at most every THEME_REFRESH_INTERVAL_MS (it forces a
 * synchronous style recalc; doing that every frame stacked with image-upload
 * work is what caused visible upload lag previously) and writes the result
 * into `target`. `step` runs every frame and eases `display` toward `target`
 * with cheap arithmetic (no DOM access), so canvas colors animate smoothly
 * across a theme change regardless of the coarse sampling rate. A hidden
 * probe element per var is used (rather than reading documentElement
 * directly) because --zzz-primary/--zzz-magenta are typed `@property
 * <color>`, whose computed serialization isn't guaranteed to be a format
 * `CanvasGradient.addColorStop` accepts (unlike a plain fillStyle
 * assignment, which fails silently on bad input); reading through a probe's
 * resolved `color` always yields a canvas-safe "rgb(...)" string.
 */
function createThemeColorCache() {
  const probes = THEME_VARS.map((varName) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;color:var(${varName})`;
    document.body.appendChild(probe);
    return probe;
  });
  const seed = probes.map((probe) => parseRgb(getComputedStyle(probe).color));
  const target: RGB[] = seed.map((c) => ({ ...c }));
  const display: RGB[] = seed.map((c) => ({ ...c }));
  let lastRefresh = -Infinity;
  // getComputedStyle forces a synchronous style recalc, which is genuinely
  // costly on this page (heavy backdrop-filter blur on .glass/.glass-btn
  // everywhere). Sampling only matters while a theme change might still be
  // settling; gating it behind this flag means plain mouse movement (which
  // keeps the rAF loop alive for the trail/spotlight) no longer pays that
  // cost every THEME_REFRESH_INTERVAL_MS for no reason.
  let needsSampling = false;

  return {
    markDirty: () => {
      needsSampling = true;
    },
    refreshIfStale: (now: number) => {
      if (!needsSampling) return;
      if (now - lastRefresh < THEME_REFRESH_INTERVAL_MS) return;
      lastRefresh = now;
      let changed = false;
      probes.forEach((probe, i) => {
        const next = parseRgb(getComputedStyle(probe).color);
        if (next.r !== target[i].r || next.g !== target[i].g || next.b !== target[i].b) changed = true;
        target[i] = next;
      });
      // The underlying CSS custom property has stopped moving (its own
      // 300ms transition settled) — no need to keep sampling until the next
      // real theme change wakes us via markDirty().
      if (!changed) needsSampling = false;
    },
    step: (dt: number) => {
      const factor = 1 - Math.exp(-dt / THEME_TRANSITION_TAU_MS);
      display.forEach((c, i) => {
        c.r += (target[i].r - c.r) * factor;
        c.g += (target[i].g - c.g) * factor;
        c.b += (target[i].b - c.b) * factor;
      });
    },
    isActive: () =>
      needsSampling ||
      display.some(
        (c, i) =>
          Math.abs(c.r - target[i].r) > THEME_TRANSITION_EPSILON ||
          Math.abs(c.g - target[i].g) > THEME_TRANSITION_EPSILON ||
          Math.abs(c.b - target[i].b) > THEME_TRANSITION_EPSILON,
      ),
    primary: () => formatRgb(display[0]),
    random: () => formatRgb(display[Math.floor(Math.random() * display.length)]),
    dispose: () => probes.forEach((probe) => probe.remove()),
  };
}

/**
 * Global input-feedback overlay: click ripples, a cursor trail, a persistent
 * spotlight that follows the pointer anywhere on the page, and an edge pulse
 * on scroll. Mount once near the app root. Disabled entirely (no listeners,
 * no canvas) when the user's saved preference is off or the OS has
 * prefers-reduced-motion set.
 */
export function CursorEffects() {
  const { enabled, reduced, setEnabled } = useCursorEffectsPref();
  const freeloadEnabled = useStore((s) => s.freeloadEnabled);
  const setFreeloadEnabled = useStore((s) => s.setFreeloadEnabled);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mousePosRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const lastTrailRef = useRef<{ x: number; y: number }>({ x: -Infinity, y: -Infinity });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let particles = particlesRef.current;
    let rafId = 0;
    let lastTrailX = lastTrailRef.current.x;
    let lastTrailY = lastTrailRef.current.y;
    let lastScrollPulse = 0;
    let mouseX: number | null = mousePosRef.current.x;
    let mouseY: number | null = mousePosRef.current.y;
    let frameScheduled = false;
    const spotlightRadius = matchMedia('(pointer: coarse)').matches ? SPOTLIGHT_RADIUS_TOUCH : SPOTLIGHT_RADIUS;
    const maxParticles = matchMedia('(pointer: coarse)').matches ? MAX_PARTICLES_TOUCH : MAX_PARTICLES;
    let lastScrollTouchY = 0;
    let lastScrollPulseTouch = 0;
    const themeColors = createThemeColorCache();

    let resizeTimer: ReturnType<typeof setTimeout>;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        requestTick();
      }, 200);
    };

    // Only animates while there's a reason to: active particles, or a fresh
    // pointer/click/wheel event since the last frame. Otherwise the loop
    // stops scheduling and the renderer sits fully idle — a continuously
    // running rAF loop was found to keep the renderer busy enough to add
    // noticeable delay to unrelated main-thread work (e.g. native file
    // picker IPC after clicking an upload dropzone).
    const requestTick = () => {
      if (frameScheduled) return;
      frameScheduled = true;
      // Always refresh theme colours when waking from idle, in case a
      // palette change landed while the loop was asleep (MutationObserver
      // depends on style-attribute timing, which may miss the first frame
      // after an upload when variables haven't been applied yet).
      themeColors.markDirty();
      // Waking from idle: reset the clock so the first tick's dt is a
      // normal frame interval, not however long the loop was idle for.
      // Without this, themeColors.step(dt) and particle life both jump by
      // that stale gap on the first frame — the color/ripple snaps straight
      // to its end state instead of easing, which is what made switching
      // between images (a slower, often-idle-first theme change) look like
      // an instant cut rather than a transition.
      lastFrame = performance.now();
      rafId = requestAnimationFrame(tick);
    };

    // Wakes the loop the moment the theme changes (upload/delete/switch all
    // go through applyTheme/resetTheme, which mutate documentElement's style
    // attribute) — otherwise, if the loop is idle because the mouse hasn't
    // moved, nothing would ever notice the new target color.
    const themeObserver = new MutationObserver(() => {
      themeColors.markDirty();
      requestTick();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

    let lastFrame = performance.now();
    const tick = (now: number) => {
      if (!enabledRef.current) { frameScheduled = false; return; }
      frameScheduled = false;
      // Re-sync from refs so a quick disable→enable cycle picks up the
      // freshly-cleared state instead of stale closure variables.
      particles = particlesRef.current;
      lastTrailX = lastTrailRef.current.x;
      lastTrailY = lastTrailRef.current.y;
      mouseX = mousePosRef.current.x;
      mouseY = mousePosRef.current.y;
      // Clamp dt: besides the idle-wake case (handled by resetting
      // lastFrame in requestTick), a backgrounded tab also pauses rAF and
      // can hand back an arbitrarily large gap on the first frame after
      // refocusing. Cap it so particle life/color easing never jumps.
      const dt = Math.min(now - lastFrame, 50);
      lastFrame = now;
      themeColors.refreshIfStale(now);
      themeColors.step(dt);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles = particles.filter((p) => {
        p.life += dt;
        if (p.life >= p.maxLife) return false;
        const t = p.life / p.maxLife;

        if (p.kind === 'trail') {
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y - t * 12, p.r * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 * (1 - t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.maxR * t, 0, Math.PI * 2);
          ctx.stroke();
        }
        return true;
      });
      particlesRef.current = particles;
      ctx.globalAlpha = 1;

      // Persistent spotlight: follows the cursor anywhere on the page, not
      // gated to any particular element.
      if (mouseX !== null && mouseY !== null) {
        const gradient = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, spotlightRadius);
        gradient.addColorStop(0, themeColors.primary());
        gradient.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, spotlightRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Only fading particles or an in-flight color transition need
      // continued animation; a stationary spotlight at a settled color
      // doesn't need to be redrawn every frame.
      if (particles.length > 0 || themeColors.isActive()) {
        frameScheduled = true;
        rafId = requestAnimationFrame(tick);
      }
    };

    resize();
    window.addEventListener('resize', resize);

    const onPointerMove = (e: PointerEvent) => {
      if (!enabledRef.current) return;
      mouseX = e.clientX;
      mouseY = e.clientY;
      mousePosRef.current = { x: mouseX, y: mouseY };
      requestTick();
      const dx = e.clientX - lastTrailX;
      const dy = e.clientY - lastTrailY;
      if (dx * dx + dy * dy < TRAIL_MIN_DIST * TRAIL_MIN_DIST) return;
      lastTrailX = e.clientX;
      lastTrailY = e.clientY;
      lastTrailRef.current = { x: lastTrailX, y: lastTrailY };
      if (particlesRef.current.length >= maxParticles) particlesRef.current.shift();
      particlesRef.current.push({
        kind: 'trail',
        x: e.clientX,
        y: e.clientY,
        r: 2 + Math.random() * 2,
        life: 0,
        maxLife: 500 + Math.random() * 300,
        color: themeColors.random(),
      });
    };

    const onClick = (e: MouseEvent) => {
      if (!enabledRef.current) return;
      if (particlesRef.current.length >= maxParticles) particlesRef.current.shift();
      particlesRef.current.push({
        kind: 'ripple',
        x: e.clientX,
        y: e.clientY,
        r: 0,
        maxR: 60,
        life: 0,
        maxLife: 550,
        color: themeColors.random(),
      });
      requestTick();
    };

    const onWheel = () => {
      if (!enabledRef.current) return;
      const now = performance.now();
      if (now - lastScrollPulse < SCROLL_PULSE_THROTTLE_MS) return;
      lastScrollPulse = now;
      const pulse = pulseRef.current;
      if (!pulse) return;
      pulse.classList.remove('scroll-pulse-active');
      void pulse.offsetWidth;
      pulse.style.setProperty('--pulse-color', themeColors.random());
      pulse.classList.add('scroll-pulse-active');
    };

    const onMouseLeave = () => {
      mousePosRef.current = { x: null, y: null };
      requestTick();
    };

    // Mobile touch support: mirror the pointermove trail logic for touchmove
    // so drag-scrolling also produces particle trails.
    const onTouchMove = (e: TouchEvent) => {
      if (!enabledRef.current) return;
      const touch = e.touches[0];
      const tx = touch.clientX;
      const ty = touch.clientY;
      mouseX = tx;
      mouseY = ty;
      mousePosRef.current = { x: mouseX, y: mouseY };
      requestTick();
      // Touch trail: denser, faster-fading particles that feel tighter to the finger.
      const dx = tx - lastTrailX;
      const dy = ty - lastTrailY;
      if (dx * dx + dy * dy < TRAIL_MIN_DIST_TOUCH * TRAIL_MIN_DIST_TOUCH) return;
      lastTrailX = tx;
      lastTrailY = ty;
      lastTrailRef.current = { x: lastTrailX, y: lastTrailY };
      if (particlesRef.current.length >= maxParticles) particlesRef.current.shift();
      particlesRef.current.push({
        kind: 'trail',
        x: tx,
        y: ty,
        r: 3 + Math.random() * 3,
        life: 0,
        maxLife: 300 + Math.random() * 200,
        color: themeColors.random(),
      });
      // Trigger the same desktop scroll-pulse on vertical touch scroll.
      if (Math.abs(ty - lastScrollTouchY) > SCROLL_PULSE_TOUCH_DIST) {
        lastScrollTouchY = ty;
        const now = performance.now();
        if (now - lastScrollPulseTouch >= SCROLL_PULSE_TOUCH_MS) {
          lastScrollPulseTouch = now;
          const pulse = pulseRef.current;
          if (pulse) {
            pulse.classList.remove('scroll-pulse-active');
            void pulse.offsetWidth;
            pulse.style.setProperty('--pulse-color', themeColors.random());
            pulse.classList.add('scroll-pulse-active');
          }
        }
      }
    };

    // Reset the trail origin on touchstart so the first frame of a drag
    // doesn't draw a line from wherever the mouse cursor last was.
    const onTouchEnd = () => {
      mousePosRef.current = { x: null, y: null };
      requestTick();
    };

    // Reset the trail origin on touchstart so the first frame of a drag
    // doesn't draw a line from wherever the mouse cursor last was.
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      lastTrailX = touch.clientX;
      lastTrailY = touch.clientY;
      lastTrailRef.current = { x: lastTrailX, y: lastTrailY };
    };

    // Clear particles when the page is hidden (tab switch, minimise, etc.)
    // otherwise they pile up during the idle rAF pause and burst on refocus.
    const onVisibilityChange = () => {
      if (document.hidden) {
        particlesRef.current = [];
        mousePosRef.current = { x: null, y: null };
        requestTick();
      }
    };

    // Extra guard: some desktop environments don't fire visibilitychange on
    // every focus loss (e.g. clicking into a native dialog or file manager),
    // leaving stale particles that burst when the browser regains focus.
    const onBlur = () => {
      particlesRef.current = [];
      mousePosRef.current = { x: null, y: null };
      requestTick();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('click', onClick);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onBlur);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    document.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      themeObserver.disconnect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      themeColors.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!enabled) {
      particlesRef.current = [];
      mousePosRef.current = { x: null, y: null };
      lastTrailRef.current = { x: -Infinity, y: -Infinity };
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    particlesRef.current = [];
    mousePosRef.current = { x: null, y: null };
    lastTrailRef.current = { x: -Infinity, y: -Infinity };
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [enabled]);

  if (reduced) return null;

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[10000]" style={{ display: enabled ? undefined : 'none' }} aria-hidden="true" />
      <div ref={pulseRef} className="scroll-pulse-overlay pointer-events-none fixed inset-0 z-[9998]" aria-hidden="true" />
      <button
        onClick={() => setFreeloadEnabled(!freeloadEnabled)}
        aria-pressed={freeloadEnabled}
        data-active={freeloadEnabled}
        className="glass-btn fixed bottom-[3.5rem] right-4 z-[10001] px-3 py-1.5 font-mono text-[10px] tracking-widest text-zzz-text"
      >
        白嫖作者 {freeloadEnabled ? '😋' : '😐'}
      </button>
      <button
        onClick={() => setEnabled(!enabled)}
        aria-pressed={enabled}
        data-active={enabled}
        aria-label={enabled ? '关闭鼠标特效' : '开启鼠标特效'}
        className="glass-btn fixed bottom-4 right-4 z-[10001] px-3 py-1.5 font-mono text-[10px] tracking-widest text-zzz-text"
      >
        特效 {enabled ? 'ON' : 'OFF'}
      </button>
    </>
  );
}
