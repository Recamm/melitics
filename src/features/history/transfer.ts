import Papa from 'papaparse';
import { historyArchiveSchema, type FollowedPublication, type HistoryArchive, type PriceObservation } from '../../shared/contracts';

export const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
const COLUMNS = ['schemaVersion', 'exportedAt', 'recordType', 'publicationKey', 'observedAt', 'currency', 'amountMinor', 'title', 'payload'] as const;
type Row = Record<typeof COLUMNS[number], string>;

function safeTitle(value: string): string { return /^['=+\-@\t\r\n]|^\s+[=+\-@]/.test(value) ? `'${value}` : value; }

function row(archive: HistoryArchive, type: 'archive' | 'publication' | 'observation', item?: FollowedPublication | PriceObservation): Row {
	const snapshot = item?.snapshot;
	return { schemaVersion: '1', exportedAt: archive.exportedAt, recordType: type,
		publicationKey: item ? ('key' in item ? item.key : item.publicationKey) : '',
		observedAt: snapshot?.observedAt ?? '', currency: snapshot?.price?.currency ?? '',
		amountMinor: snapshot?.price ? String(snapshot.price.amountMinor) : '',
		title: safeTitle(snapshot?.title ?? ''), payload: item ? JSON.stringify(item) : '' };
}

export function exportHistory(value: unknown, format: 'json' | 'csv'): string {
	const archive = historyArchiveSchema.parse(value);
	if (format === 'json') return JSON.stringify(archive, null, 2);
	if (format !== 'csv') throw new Error('Invalid format');
	return Papa.unparse({ fields: [...COLUMNS], data: [row(archive, 'archive'),
		...archive.publications.map(item => row(archive, 'publication', item)),
		...archive.observations.map(item => row(archive, 'observation', item)),
	].map(item => COLUMNS.map(column => item[column])) }, { escapeFormulae: true, newline: '\r\n' });
}

export function importHistory(text: string, format: 'json' | 'csv'): HistoryArchive {
	if (text.length > MAX_TRANSFER_BYTES || new TextEncoder().encode(text).byteLength > MAX_TRANSFER_BYTES) throw new Error('Archive exceeds 64 MB');
	if (format === 'json') return historyArchiveSchema.parse(JSON.parse(text));
	if (format !== 'csv') throw new Error('Invalid format');
	const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true, dynamicTyping: false, preview: 50102 });
	if (parsed.errors.length || parsed.meta.truncated || parsed.data.length > 50101
		|| JSON.stringify(parsed.meta.fields) !== JSON.stringify(COLUMNS)) throw new Error('Invalid CSV');
	const metadata = parsed.data[0];
	if (!metadata || metadata.recordType !== 'archive' || metadata.schemaVersion !== '1') throw new Error('Invalid CSV version');
	const publications: unknown[] = []; const observations: unknown[] = [];
	for (const entry of parsed.data.slice(1)) {
		if (entry.schemaVersion !== '1' || entry.exportedAt !== metadata.exportedAt) throw new Error('Inconsistent CSV version');
		if (entry.recordType === 'publication') publications.push(JSON.parse(entry.payload));
		else if (entry.recordType === 'observation') observations.push(JSON.parse(entry.payload));
		else throw new Error('Invalid CSV record');
	}
	const archive = historyArchiveSchema.parse({ schemaVersion: 1, exportedAt: metadata.exportedAt, publications, observations });
	let publicationIndex = 0; let observationIndex = 0;
	for (const entry of parsed.data) {
		const type = entry.recordType as 'archive' | 'publication' | 'observation';
		const item = type === 'publication' ? archive.publications[publicationIndex++] : type === 'observation' ? archive.observations[observationIndex++] : undefined;
		const expected = row(archive, type, item);
		if (COLUMNS.some(column => column !== 'payload' && entry[column] !== expected[column]) || (type === 'archive' && entry.payload !== '')) throw new Error('Inconsistent CSV columns');
	}
	return archive;
}