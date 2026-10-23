import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let coreDir: string | undefined;

/**
 * Files the preview page loads from OpenPencil's packages: `canvaskit.wasm` (the build that
 * `@open-pencil/core/canvaskit` loads in a browser) and the bundled fonts of
 * `@open-pencil/core/assets`. Returns the path on disk, or `undefined` for another name.
 */
export function previewFile(name: string): string | undefined {
  coreDir ??= dirname(fileURLToPath(import.meta.resolve('@open-pencil/core/package.json')));
  let path: string;
  if (name === 'canvaskit.wasm') {
    const fromCore = createRequire(join(coreDir, 'package.json'));
    path = join(dirname(fromCore.resolve('canvaskit-wasm/package.json')), 'bin', name);
  } else if (/^[\w-]+\.ttf$/.test(name)) {
    path = join(coreDir, 'assets', name);
  } else {
    return undefined;
  }
  return existsSync(path) ? path : undefined;
}
