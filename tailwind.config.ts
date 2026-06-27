import type { Config } from 'tailwindcss';

// ZZZ design tokens are CSS variables (see src/styles/index.css) so they can be
// overridden at runtime by the image color extractor. Tailwind references them
// here so utility classes like `text-zzz-primary` track the live theme.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zzz: {
          bg: 'var(--zzz-bg)',
          ink: 'var(--zzz-ink)',
          panel: 'var(--zzz-panel)',
          primary: 'var(--zzz-primary)',
          magenta: 'var(--zzz-magenta)',
          cyan: 'var(--zzz-cyan)',
          accent: 'var(--zzz-accent)',
          text: 'var(--zzz-text)',
          muted: 'var(--zzz-muted)',
        },
      },
      fontFamily: {
        display: ['Oswald', 'Teko', 'Impact', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        zzz: 'var(--zzz-radius)',
      },
      boxShadow: {
        zzz: 'var(--zzz-shadow)',
      },
      transitionTimingFunction: {
        zzz: 'var(--zzz-ease)',
      },
    },
  },
  plugins: [],
} satisfies Config;
