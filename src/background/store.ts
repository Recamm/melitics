import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { historyArchiveSchema, historySnapshotSchema, observationId, publicationKey, publicationKeySchema,
  publicSellerIdSchema, sellerContactSchema, type SellerContact,
  type FollowedPublication, type HistoryArchive, type HistoryInfo, type PriceObservation, type PublicPageSnapshot } from '../shared/contracts';
import { contactCandidate } from '../features/sellers/contacts';

interface HistoryDatabase extends DBSchema {
  publications: { key: string; value: FollowedPublication };
  observations: { key: string; value: PriceObservation; indexes: { publication: string } };
  contacts: { key: string; value: SellerContact };
  settings: { key: string; value: { key: 'retention'; days: 7 | 30 | 90 } };
}

export class HistoryStoreError extends Error {
  constructor(public readonly code: 'storage-full' | 'invalid-input' | 'forbidden') { super(code); }
}

type WriteTransaction = IDBPTransaction<HistoryDatabase, ['publications', 'observations', 'contacts', 'settings'], 'readwrite'>;

export function createHistoryStore(name = 'meli-history') {
  let database: Promise<IDBPDatabase<HistoryDatabase>> | undefined;
  function connection(): Promise<IDBPDatabase<HistoryDatabase>> {
    database ??= openDB<HistoryDatabase>(name, 1, {
      upgrade(db) {
        db.createObjectStore('publications', { keyPath: 'key' });
        db.createObjectStore('observations', { keyPath: 'id' }).createIndex('publication', 'publicationKey');
        db.createObjectStore('contacts', { keyPath: 'key' });
        db.createObjectStore('settings', { keyPath: 'key' });
      },
      blocking() { void database?.then(db => db.close()); database = undefined; },
      terminated() { database = undefined; },
    }).catch(error => { database = undefined; throw error; });
    return database;
  }

  async function write<Result>(operation: (transaction: WriteTransaction) => Promise<Result>): Promise<Result> {
    const db = await connection();
    const transaction = db.transaction(['publications', 'observations', 'contacts', 'settings'], 'readwrite');
    try {
      const result = await operation(transaction);
      await transaction.done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await transaction.done.catch(() => undefined);
      if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new HistoryStoreError('storage-full');
      throw error;
    }
  }

  async function archive(): Promise<HistoryArchive> {
    const db = await connection();
    const transaction = db.transaction(['publications', 'observations']);
    const publications = await transaction.objectStore('publications').getAll();
    const observations = await transaction.objectStore('observations').getAll();
    await transaction.done;
    return historyArchiveSchema.parse({ schemaVersion: 1, exportedAt: new Date().toISOString(), publications, observations });
  }

  return {
    archive,
    async saveContact(value: PublicPageSnapshot): Promise<void> {
      const contact = contactCandidate(value);
      if (!contact) throw new HistoryStoreError('invalid-input');
      await write(async transaction => {
        const contacts = transaction.objectStore('contacts'); const previous = await contacts.get(contact.key);
        if (!previous && await contacts.count() >= 1000) throw new HistoryStoreError('storage-full');
        if (!previous || previous.observedAt <= contact.observedAt) await contacts.put(contact);
      });
    },
    async readContacts(sellerId: string): Promise<SellerContact[]> {
      publicSellerIdSchema.parse(sellerId);
      return (await (await connection()).getAll('contacts')).filter(contact => contact.sellerId === sellerId).map(contact => sellerContactSchema.parse(contact));
    },
    async removeContact(key: string, confirmed: boolean): Promise<void> {
      if (confirmed !== true) throw new HistoryStoreError('forbidden');
      if (!key || key.length > 2300) throw new HistoryStoreError('invalid-input');
      await write(async transaction => { await transaction.objectStore('contacts').delete(key); });
    },
    async unfollow(value: string): Promise<void> {
      const key = publicationKeySchema.parse(value);
      await write(async transaction => {
        const publication = await transaction.objectStore('publications').get(key);
        if (publication) await transaction.objectStore('publications').put({ ...publication, following: false });
      });
    },
    async merge(value: unknown) {
      const imported = historyArchiveSchema.parse(value);
      return write(async transaction => {
        const publications = transaction.objectStore('publications');
        const observations = transaction.objectStore('observations');
        for (const publication of imported.publications) {
          const previous = await publications.get(publication.key);
          if (!previous) await publications.add(publication);
          else if (publication.snapshot.observedAt > previous.snapshot.observedAt) await publications.put({ ...previous, snapshot: publication.snapshot });
        }
        let added = 0;
        let duplicates = 0;
        for (const observation of imported.observations) {
          const previous = await observations.get(observation.id);
          if (previous) {
            if (previous.snapshot.price?.amountMinor !== observation.snapshot.price?.amountMinor) throw new HistoryStoreError('invalid-input');
            duplicates += 1;
          } else { await observations.add(observation); added += 1; }
        }
        if (await publications.count() > 100 || await observations.count() > 50000) throw new HistoryStoreError('storage-full');
        return { imported: added, duplicates };
      });
    },
    async prune(days: number, confirmed: boolean) {
      if (confirmed !== true) throw new HistoryStoreError('forbidden');
      if (days !== 7 && days !== 30 && days !== 90) throw new HistoryStoreError('invalid-input');
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      return write(async transaction => {
        let removed = 0;
        const observations = transaction.objectStore('observations');
        for (const observation of await observations.getAll()) {
          if (observation.snapshot.observedAt < cutoff) { await observations.delete(observation.id); removed += 1; }
        }
        await transaction.objectStore('settings').put({ key: 'retention', days });
        return { removed };
      });
    },
    async remove(value: string, confirmed: boolean): Promise<void> {
      if (confirmed !== true) throw new HistoryStoreError('forbidden');
      const key = publicationKeySchema.parse(value);
      await write(async transaction => {
        const observations = transaction.objectStore('observations');
        for (const id of await observations.index('publication').getAllKeys(key)) await observations.delete(id);
        await transaction.objectStore('publications').delete(key);
      });
    },
    async clear(confirmed: boolean): Promise<void> {
      if (confirmed !== true) throw new HistoryStoreError('forbidden');
      await write(async transaction => { for (const name of ['publications', 'observations', 'contacts'] as const) await transaction.objectStore(name).clear(); });
    },
    async info(): Promise<HistoryInfo> {
      const db = await connection();
      const transaction = db.transaction(['publications', 'observations', 'contacts', 'settings']);
      const publicationCount = await transaction.objectStore('publications').count();
      const observationCount = await transaction.objectStore('observations').count();
      const contactCount = await transaction.objectStore('contacts').count();
      const retention = await transaction.objectStore('settings').get('retention');
      await transaction.done;
      return { publicationCount, observationCount, publicationLimit: 100, observationLimit: 50000, contactCount, retentionDays: retention?.days ?? 90 };
    },
    async follow(value: PublicPageSnapshot): Promise<void> {
      const snapshot = historySnapshotSchema.parse(value);
      const key = publicationKey(snapshot);
      await write(async transaction => {
        const publications = transaction.objectStore('publications');
        const previous = await publications.get(key);
        if (!previous && await publications.count() >= 100) throw new HistoryStoreError('storage-full');
        await publications.put({ key, snapshot: previous && previous.snapshot.observedAt > snapshot.observedAt ? previous.snapshot : snapshot,
          following: true, followedAt: previous?.followedAt ?? new Date().toISOString() });
      });
    },
    async record(value: PublicPageSnapshot): Promise<{ status: 'recorded' | 'duplicate' | 'not-following' }> {
      const snapshot = historySnapshotSchema.parse(value);
      const key = publicationKey(snapshot);
      const id = observationId(snapshot);
      return write(async transaction => {
        const publication = await transaction.objectStore('publications').get(key);
        if (!publication?.following) return { status: 'not-following' };
        if (await transaction.objectStore('observations').get(id)) return { status: 'duplicate' };
        if (await transaction.objectStore('observations').count() >= 50000) throw new HistoryStoreError('storage-full');
        await transaction.objectStore('observations').add({ id, publicationKey: key, snapshot });
        if (snapshot.observedAt >= publication.snapshot.observedAt) await transaction.objectStore('publications').put({ ...publication, snapshot });
        return { status: 'recorded' };
      });
    },
    async read(value: string) {
      const key = publicationKeySchema.parse(value);
      const db = await connection();
      const transaction = db.transaction(['publications', 'observations']);
      const publication = await transaction.objectStore('publications').get(key) ?? null;
      const observations = await transaction.objectStore('observations').index('publication').getAll(key);
      await transaction.done;
      return { publication, observations };
    },
    async list() { return (await connection()).getAll('publications'); },
    async close(): Promise<void> { if (database) { (await database).close(); database = undefined; } },
  };
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;