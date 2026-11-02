import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_POLICY } from '../src/features/assistant/client';

const bundle = resolve('.output/chrome-mv3');

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Delivery must not contain symbolic links');
    return entry.isDirectory() ? files(fullPath) : [fullPath];
  });
}

describe('local extension delivery', () => {
  it('ships current installation, privacy and validation documentation', () => {
    for (const name of ['README.md', 'PRIVACY.md', 'docs/implementation-plan.md']) {
      expect(readFileSync(join(bundle, name), 'utf8')).toBe(readFileSync(name, 'utf8'));
    }
  });

  it('preserves production dependency licenses and notices verbatim', () => {
    const notices = readFileSync(join(bundle, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { dev?: boolean; version?: string; resolved?: string }>;
    };
    for (const [directory, item] of Object.entries(lock.packages)) {
      if (!directory.startsWith('node_modules/') || item.dev) continue;
      expect(item.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
        name: string; version: string;
      };
      expect(notices).toContain(`${metadata.name}@${metadata.version}`);
      const documents = readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice|ofl)([.-]|$)/i.test(name));
      expect(documents.length).toBeGreaterThan(0);
      for (const document of documents) expect(notices).toContain(readFileSync(join(directory, document), 'utf8'));
    }
  });

  it('includes extension runtime helpers even when npm marks them as development dependencies', () => {
    const notices = readFileSync(join(bundle, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    for (const name of ['wxt', '@wxt-dev/browser', '@webext-core/isolated-element', '@webext-core/match-patterns', '@1natsu/wait-element', 'is-potential-custom-element-name', 'defu', 'many-keys-map']) {
      const metadata = JSON.parse(readFileSync(join('node_modules', name, 'package.json'), 'utf8')) as { version: string };
      expect(notices).toContain(`${name}@${metadata.version}`);
    }
  });

  it('excludes source maps, fixtures, development clients and recognizable credentials', () => {
    for (const fullPath of files(bundle)) {
      const name = relative(bundle, fullPath).replaceAll('\\', '/');
      expect(name).not.toMatch(/(^|\/)(?:node_modules|src|tests|\.git|\.env(?:\..*)?)(?:\/|$)|\.(?:map|pem|key)$/i);
      if (!/\.(?:js|html)$/.test(name)) continue;
      const content = readFileSync(fullPath, 'utf8');
      expect(content).not.toMatch(/https?:\/\/(?:localhost|127\.0\.0\.1)|@vite\/client|__vite_ping/);
      expect(content).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{30,}\b|\bsk-[A-Za-z0-9]{32,}\b/);
      expect(content).not.toContain('agkdknlphoikfmliifdcdgijjhmcjile');
      expect(content).not.toContain('Camara de prueba');
      expect(content).not.toContain('TIENDA_PRUEBA');
    }
  });

  it('retains the explicitly disabled, zero-budget assistant policy', () => {
    expect(ASSISTANT_POLICY).toEqual({
      provider: null, monthlyBudgetUsd: 0, hosting: 'local-only',
      dataPolicy: 'no-transmission', enabled: false,
    });
  });
});