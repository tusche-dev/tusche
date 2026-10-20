import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const RETRIES = 5;

/**
 * Writes a file atomically: a temporary file next to it, then a rename. On Windows the
 * rename fails with EPERM/EBUSY while another program (an editor, an antivirus) holds the
 * target for a moment, so it is retried.
 */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= RETRIES || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await rm(temp, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}
