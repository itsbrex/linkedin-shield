/** Catalog integrity, including every captured ID/resource pair. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../known-extensions.js', import.meta.url), 'utf8');
const { KNOWN_EXTENSIONS, CATEGORY_RISKS, EXTENSION_PROBES } = runInNewContext(
  `${source}\n({ KNOWN_EXTENSIONS, CATEGORY_RISKS, EXTENSION_PROBES });`,
);

describe('Known Extensions — Captured Registry', () => {
  it('preserves all 4,934 unique ID/file pairs from const o', () => {
    const pairs = Object.entries(EXTENSION_PROBES).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    expect(pairs).toHaveLength(4934);
    // Independently calculated from the source array, before catalog generation.
    expect(createHash('sha256').update(JSON.stringify(pairs)).digest('hex')).toBe(
      '2b1825e71d31f243283623d96e7d7ac04a281bd91fe8ff01bace34c6de50820b',
    );
  });

  it('retains exact filenames, including bracketed font names', () => {
    expect(KNOWN_EXTENSIONS.aaaeoelkococjpgngfokhbkkfiiegolp.file).toBe('icon/16.png');
    expect(KNOWN_EXTENSIONS.dhkfoinnpjgabapcgjkmjophfincioij.file).toBe('assets/fonts/vazir/Vazirmatn[wght].woff2');
    expect(KNOWN_EXTENSIONS.pppndnondekehijelkdnlihcfehjacfe.file).toBe('jc.98ee31a0.css');
  });

  it('does not invent names for unidentified extensions', () => {
    expect(KNOWN_EXTENSIONS.aaaeoelkococjpgngfokhbkkfiiegolp).toEqual({
      name: 'Unidentified extension',
      category: 'Unclassified',
      file: 'icon/16.png',
    });
    expect(KNOWN_EXTENSIONS.cjpalhdlnbpafiamejdnhcphjbkeiagm.name).toBe('uBlock Origin');
  });

  it('exposes every captured file through KNOWN_EXTENSIONS', () => {
    for (const [id, file] of Object.entries(EXTENSION_PROBES)) {
      expect(KNOWN_EXTENSIONS[id].file).toBe(file);
    }
  });
});

describe('Known Extensions — Data Integrity', () => {
  it('uses valid Chrome IDs and defined category descriptions', () => {
    for (const [id, extension] of Object.entries(KNOWN_EXTENSIONS)) {
      expect(id).toMatch(/^[a-p]{32}$/);
      expect(extension.name.length).toBeGreaterThan(0);
      expect(CATEGORY_RISKS[extension.category]).toBeTruthy();
    }
  });

  it('keeps probe paths relative to extension origins', () => {
    for (const file of Object.values(EXTENSION_PROBES)) {
      expect(typeof file).toBe('string');
      expect(file.length).toBeGreaterThan(0);
      expect(file).not.toMatch(/^(?:\/|[a-z]+:)/i);
      expect(file.split('/')).not.toContain('..');
    }
  });
});
