import { build } from 'esbuild';
import { resolve } from 'node:path';

// Exercise browser TypeScript modules using the bundler already required by
// Vite. No production test hook or new test dependency is needed.
export async function loadFrontend(contents) {
  const result = await build({
    stdin: { contents, resolveDir: resolve('.'), sourcefile: 'frontend-test.ts', loader: 'ts' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"test"' },
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
