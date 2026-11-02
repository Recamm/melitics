import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const outputDirectory = resolve('.output/chrome-mv3');
const manifest = z.looseObject({
  manifest_version: z.number(),
  name: z.string(),
  version: z.string(),
  minimum_chrome_version: z.string(),
  permissions: z.array(z.string()),
  host_permissions: z.array(z.string()),
  background: z.looseObject({ service_worker: z.string() }),
  content_security_policy: z.looseObject({ extension_pages: z.string() }),
  action: z.strictObject({ default_title: z.string(), default_popup: z.string() }),
  options_ui: z.strictObject({ page: z.literal('options.html'), open_in_tab: z.literal(true) }),
  content_scripts: z.array(z.looseObject({ matches: z.array(z.string()), js: z.array(z.string()), run_at: z.string() })),
  web_accessible_resources: z.array(z.strictObject({ resources: z.array(z.string()), use_dynamic_url: z.boolean(), matches: z.array(z.string()) })),
}).parse(JSON.parse(readFileSync(resolve(outputDirectory, 'manifest.json'), 'utf8')));

describe('production manifest', () => {
  it('targets Manifest V3 and Chrome 120 with independent branding', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe('120');
    expect(manifest.name).toBe('MeliExtension');
    expect(manifest.version).toBe('0.1.0');
  });

  it('grants only storage and the selected HTTPS marketplace', () => {
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.host_permissions).toEqual(['https://*.mercadolibre.com.ar/*']);
    expect(manifest).not.toHaveProperty('optional_permissions');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
  });

  it('does not expose external messaging or copied extension integration', () => {
    for (const field of ['externally_connectable', 'devtools_page', 'key', 'update_url']) {
      expect(manifest).not.toHaveProperty(field);
    }
    expect(manifest.action).toEqual({ default_title: 'MeliExtension', default_popup: 'popup.html' });
    expect(manifest.content_scripts).toEqual([{ matches: ['https://*.mercadolibre.com.ar/*'], run_at: 'document_idle', js: ['content-scripts/mercadolibre.js'] }]);
    expect(manifest.web_accessible_resources).toEqual([{ resources: ['content-scripts/mercadolibre.css'], use_dynamic_url: true, matches: ['https://*.mercadolibre.com.ar/*'] }]);
    expect(existsSync(resolve(outputDirectory, 'popup.html'))).toBe(true);
    expect(existsSync(resolve(outputDirectory, manifest.options_ui.page))).toBe(true);
  });

  it('loads a bundled service worker that exists in the output', () => {
    expect(manifest.background.service_worker).toBe('background.js');
    expect(existsSync(resolve(outputDirectory, manifest.background.service_worker))).toBe(true);
  });

  it('forbids remote scripts and dynamic evaluation in the production CSP', () => {
    expect(manifest.content_security_policy.extension_pages)
      .toBe("script-src 'self'; object-src 'none'; img-src 'self' https://mlstatic.com https://*.mlstatic.com; font-src 'self'; connect-src 'self'; base-uri 'none'");
  });
});