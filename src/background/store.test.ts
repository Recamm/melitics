import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicPageSnapshot } from '../shared/contracts';
import { createHistoryStore } from './store';

const stores: ReturnType<typeof createHistoryStore>[] = [];
const names = new Set<string>();
function store(name = `meli-test-${crypto.randomUUID()}`) {
  names.add(name);
  const instance = createHistoryStore(name);
  stores.push(instance);
  return instance;
}

export function snapshot(listingId = 'MLA123456789', observedAt = '2026-11-01T12:00:00.000Z'): PublicPageSnapshot {
  return {
    siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId, productId: null,
    canonicalUrl: `https://articulo.mercadolibre.com.ar/MLA-${listingId.slice(3)}-prueba`,
    title: 'Publicacion de prueba', price: { amountMinor: 10000, currency: 'ARS', exponent: 2 },
    imageUrl: null, seller: null, observedAt, extractorRevision: 'public-v1',
    provenance: { price: { source: 'json-ld', url: `https://articulo.mercadolibre.com.ar/MLA-${listingId.slice(3)}-prueba` } },
  };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map(instance => instance.close()));
  for (const name of names) await deleteDB(name);
  names.clear();
});

describe('transactional local history', () => {
  it('saves contacts only explicitly, isolates sellers and survives restart without altering history', async () => {
    const name = `meli-test-${crypto.randomUUID()}`; const instance = store(name);
    const first = { ...snapshot(), seller: { id: '98765', name: 'Fixture A', url: 'https://www.mercadolibre.com.ar/perfil/FIXTURE_A' } };
    const second = { ...snapshot('MLA987654321'), seller: { id: '12345', name: 'Fixture B', url: 'https://www.mercadolibre.com.ar/perfil/FIXTURE_B' } };
    await instance.follow(first); await instance.record(first);
    expect(await instance.readContacts('98765')).toEqual([]);
    await Promise.all([instance.saveContact(first), instance.saveContact(second)]); await instance.saveContact(first);
    await instance.close(); const restarted = store(name);
    expect(await restarted.readContacts('98765')).toMatchObject([{ sellerId: '98765' }]);
    expect(await restarted.readContacts('12345')).toMatchObject([{ sellerId: '12345' }]);
    expect((await restarted.archive()).observations).toHaveLength(1);
    expect(await restarted.info()).toMatchObject({ contactCount: 2 });
    const key = JSON.stringify(['MLA', '98765', 'profile', first.seller.url]);
    await expect(restarted.removeContact(key, false)).rejects.toBeTruthy();
    await restarted.removeContact(key, true); expect(await restarted.readContacts('98765')).toEqual([]);
    await restarted.clear(true); expect(await restarted.readContacts('12345')).toEqual([]);
  });
  it('rejects unsafe contact candidates before storing anything', async () => {
    const instance = store();
    await expect(instance.saveContact({ ...snapshot(), seller: { id: '98765', name: 'Fixture', url: 'javascript:alert(1)' } })).rejects.toBeTruthy();
    expect(await instance.readContacts('98765')).toEqual([]);
  });

  it('deduplicates different UTC representations of the same capture instant', async () => {
    const instance = store();
    await instance.follow(snapshot());
    await instance.record(snapshot());
    expect(await instance.record(snapshot('MLA123456789', '2026-11-01T12:00:00Z'))).toEqual({ status: 'duplicate' });
  });

  it('rolls back a quota failure and preserves the previously confirmed observation', async () => {
    const instance = store();
    await instance.follow(snapshot()); await instance.record(snapshot());
    const failure = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('fixture quota', 'QuotaExceededError'); });
    await expect(instance.record(snapshot('MLA123456789', '2026-11-01T13:00:00.000Z'))).rejects.toMatchObject({ code: 'storage-full' });
    failure.mockRestore();
    expect((await instance.read('MLA:listing:MLA123456789')).observations).toHaveLength(1);
  });

  it('does not partially import new publications when the total limit would be exceeded', async () => {
    const instance = store();
    for (let index = 0; index < 100; index += 1) await instance.follow(snapshot(`MLA${100000 + index}`));
    const source = store(); await source.follow(snapshot()); await source.record(snapshot());
    await expect(instance.merge(await source.archive())).rejects.toMatchObject({ code: 'storage-full' });
    expect(await instance.list()).toHaveLength(100);
    expect(await instance.read('MLA:listing:MLA123456789')).toEqual({ publication: null, observations: [] });
  });

  it('deduplicates simultaneous captures by identity, date, currency and source', async () => {
    const instance = store();
    const current = snapshot();
    await instance.follow(current);
    const statuses = await Promise.all([instance.record(current), instance.record(current)]);
    expect(statuses.map(result => result.status).sort()).toEqual(['duplicate', 'recorded']);
    expect((await instance.read('MLA:listing:MLA123456789')).observations).toHaveLength(1);
  });

  it('unfollows without deleting the previously captured history', async () => {
    const instance = store();
    await instance.follow(snapshot());
    await instance.record(snapshot());
    await instance.unfollow('MLA:listing:MLA123456789');
    expect(await instance.record(snapshot('MLA123456789', '2026-11-01T13:00:00.000Z'))).toEqual({ status: 'not-following' });
    expect((await instance.read('MLA:listing:MLA123456789')).observations).toHaveLength(1);
  });

  it('retains explicit gaps and changed currencies as separate captures', async () => {
    const instance = store();
    await instance.follow(snapshot());
    await instance.record({ ...snapshot(), price: null, provenance: {} });
    await instance.record(snapshot());
    await instance.record({ ...snapshot(), price: { amountMinor: 100, currency: 'USD', exponent: 2 } });
    expect((await instance.read('MLA:listing:MLA123456789')).observations).toHaveLength(3);
  });

  it('rejects private routes, contradictory URLs and unrecognized snapshot fields', async () => {
    const instance = store();
    for (const input of [
      { ...snapshot(), canonicalUrl: 'https://evil.example/MLA-123456789-prueba' },
      { ...snapshot(), canonicalUrl: 'https://www.mercadolibre.com.ar/my-account/orders' },
      { ...snapshot(), canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-987654321-ajena' },
      { ...snapshot(), buyerId: 'private-fixture' },
      { ...snapshot(), seller: { id: null, name: 'Fixture', url: 'https://www.mercadolibre.com.ar/my-account/orders' } },
      { ...snapshot(), provenance: { price: { source: 'dom' as const, url: 'https://www.mercadolibre.com.ar/my-account/orders' } } },
      { ...snapshot(), canonicalUrl: `${snapshot().canonicalUrl}?token=private-fixture` },
    ]) await expect(instance.follow(input)).rejects.toBeTruthy();
    expect(await instance.list()).toHaveLength(0);
  });

  it('exports a versioned archive and merges duplicates without replacing unrelated data', async () => {
    const source = store();
    await source.follow(snapshot()); await source.record(snapshot());
    const archive = await source.archive();
    const destination = store();
    await destination.follow(snapshot('MLA987654321'));
    expect(await destination.merge(archive)).toEqual({ imported: 1, duplicates: 0 });
    expect(await destination.merge(archive)).toEqual({ imported: 0, duplicates: 1 });
    expect(await destination.list()).toHaveLength(2);
    await expect(destination.merge({ ...archive, schemaVersion: 99 })).rejects.toBeTruthy();
    expect((await destination.read('MLA:listing:MLA123456789')).observations).toHaveLength(1);
  });

  it('never applies deletion or retention without confirmation', async () => {
    const instance = store();
    await instance.follow(snapshot());
    await instance.record(snapshot('MLA123456789', '2025-01-01T00:00:00.000Z'));
    await instance.record(snapshot());
    await expect(instance.prune(90, false)).rejects.toBeTruthy();
    await expect(instance.remove('MLA:listing:MLA123456789', false)).rejects.toBeTruthy();
    expect((await instance.read('MLA:listing:MLA123456789')).observations).toHaveLength(2);
    expect(await instance.prune(90, true)).toEqual({ removed: 1 });
    await instance.remove('MLA:listing:MLA123456789', true);
    expect(await instance.read('MLA:listing:MLA123456789')).toEqual({ publication: null, observations: [] });
  });

  it('preserves concurrent confirmed observations from two tabs after worker restart', async () => {
    const name = `meli-test-${crypto.randomUUID()}`;
    const left = store(name);
    const right = store(name);
    const first = snapshot();
    const second = snapshot('MLA987654321');
    await Promise.all([left.follow(first), right.follow(second)]);
    expect(await Promise.all([left.record(first), right.record(second)]))
      .toEqual([{ status: 'recorded' }, { status: 'recorded' }]);
    await Promise.all([left.close(), right.close()]);
    const restarted = store(name);
    expect(await restarted.list()).toHaveLength(2);
    expect((await restarted.read('MLA:listing:MLA123456789')).observations).toHaveLength(1);
    expect((await restarted.read('MLA:listing:MLA987654321')).observations).toHaveLength(1);
  });
});