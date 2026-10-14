import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

export interface ZipFiles { [path: string]: Uint8Array }

/** Read a whole zip into memory (Kenney packs are a few MB each). */
export function readZip(path: string): ZipFiles {
  return unzipSync(new Uint8Array(readFileSync(path)));
}

/** Find a zip entry by its path, tolerating a leading folder. */
export function findEntry(files: ZipFiles, relPath: string): Uint8Array | undefined {
  const norm = relPath.replace(/\\/g, '/');
  if (files[norm]) return files[norm];
  const key = Object.keys(files).find((k) => k.endsWith('/' + norm));
  return key ? files[key] : undefined;
}
