import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shared plumbing for the document loaders (Phase 2): the brand block that
 * every PDF opens with, and the storage mirror so messaging can attach the
 * same bytes by URL later.
 */

export const brand = {
  name: process.env.COMPANY_NAME || 'Gabfix',
  tagline: 'Cleaning, laundry and facility services',
  phone: process.env.COMPANY_PHONE || '+256 700 000 000',
  address: 'Kampala, Uganda',
};

export type RenderedDocument = {
  buffer: Buffer;
  filename: string;
};

/** Storage mirror root (plan: DOCUMENT_STORAGE_DIR, default ./storage/documents). */
const storageDir = (): string => process.env.DOCUMENT_STORAGE_DIR || join(process.cwd(), 'storage', 'documents');

export function mirror(filename: string, buffer: Buffer): void {
  try {
    mkdirSync(storageDir(), { recursive: true });
    writeFileSync(join(storageDir(), filename), buffer);
  } catch {
    // The download still succeeds when the mirror directory is unwritable;
    // messaging re-renders on demand rather than reading the mirror.
  }
}
