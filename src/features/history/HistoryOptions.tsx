import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink, Package, RefreshCw, Star, StarOff, Trash2, Upload } from 'lucide-react';
import { historyRequest } from '../../messaging/client';
import { publicationKeySchema, type FollowedPublication, type HistoryArchive, type HistoryData, type HistoryInfo } from '../../shared/contracts';
import { HistoryView } from './HistoryView';
import { exportHistory, importHistory, MAX_TRANSFER_BYTES } from './transfer';

const HistoryChart = lazy(() => import('./HistoryChart'));
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	override state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	override render() { return this.state.failed ? <p role="status">Gr&aacute;fico no disponible. Tabla conservada.</p> : this.props.children; }
}
type Confirmation = { type: 'import'; archive: HistoryArchive } | { type: 'prune'; days: 7 | 30 | 90 } | { type: 'remove'; key: string } | { type: 'clear' };

export function HistoryOptions() {
	const [publications, setPublications] = useState<FollowedPublication[]>([]);
	const [info, setInfo] = useState<HistoryInfo | null>(null);
	const [selected, setSelected] = useState<string | null>(() => {
		try { const parsed = publicationKeySchema.safeParse(decodeURIComponent(location.hash.slice(1))); return parsed.success ? parsed.data : null; } catch { return null; }
	});
	const [data, setData] = useState<HistoryData | null>(null);
	const [revision, setRevision] = useState(0);
	const [format, setFormat] = useState<'json' | 'csv'>('json');
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	const alive = useRef(true);
	const saving = useRef(false);
	const loadGeneration = useRef(0);

	async function load(): Promise<void> {
		const generation = ++loadGeneration.current;
		const [list, counts] = await Promise.all([historyRequest('history.list', {}, 'list'), historyRequest('history.info', {}, 'info')]);
		if (!alive.current || generation !== loadGeneration.current) return;
		setPublications(list.publications); setInfo(counts);
		setSelected(current => list.publications.some(item => item.key === current) ? current : list.publications[0]?.key ?? null);
		setRevision(value => value + 1);
	}
	useEffect(() => {
		alive.current = true;
		void load().catch(() => { if (alive.current) setError('No se pudo leer el historial.'); });
		return () => { alive.current = false; loadGeneration.current += 1; };
	}, []);
	useEffect(() => {
		let active = true;
		setData(null);
		if (selected) void historyRequest('history.read', { key: selected }, 'data').then(value => {
			if (active) setData({ publication: value.publication, observations: value.observations });
		}, () => { if (active) setError('No se pudo leer esta publicaci\u00f3n.'); });
		return () => { active = false; };
	}, [selected, revision]);
	useEffect(() => {
		if (confirmation) dialog.current?.showModal();
		else if (dialog.current?.open) dialog.current.close();
	}, [confirmation]);

	async function run(operation: () => Promise<string>): Promise<void> {
		if (saving.current) return;
		saving.current = true; setBusy(true); setError(null); setMessage(null);
		try {
			const next = await operation();
			if (alive.current) { setConfirmation(null); setMessage(next); await load(); }
		} catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Operacion no disponible.'); }
		finally { saving.current = false; if (alive.current) setBusy(false); }
	}
	async function confirm(): Promise<string> {
		if (!confirmation) return '';
		switch (confirmation.type) {
			case 'import': {
				const result = await historyRequest('history.import', { archive: confirmation.archive }, 'merged');
				return `${result.imported} capturas importadas; ${result.duplicates} duplicadas.`;
			}
			case 'prune': {
				const result = await historyRequest('history.prune', { days: confirmation.days, confirmed: true }, 'pruned');
				return `${result.removed} capturas eliminadas. No hay limpieza automatica.`;
			}
			case 'remove': await historyRequest('history.remove', { key: confirmation.key, confirmed: true }, 'done'); return 'Publicacion e historial eliminados.';
			case 'clear': await historyRequest('history.clear', { confirmed: true }, 'done'); return 'Datos del historial eliminados.';
		}
	}
	async function prepareImport(file: File): Promise<void> {
		if (saving.current) return;
		saving.current = true; setBusy(true); setError(null); setMessage(null);
		try {
			if (file.size > MAX_TRANSFER_BYTES || !/\.(json|csv)$/i.test(file.name)) throw new Error('Invalid file');
			const archive = importHistory(await file.text(), /\.csv$/i.test(file.name) ? 'csv' : 'json');
			if (alive.current) setConfirmation({ type: 'import', archive });
		} catch { if (alive.current) setError('Archivo no valido. No se modificaron los datos.'); }
		finally { saving.current = false; if (alive.current) setBusy(false); }
	}
	async function download(): Promise<string> {
		const archive = (await historyRequest('history.export', {}, 'archive')).archive;
		const blob = new Blob([exportHistory(archive, format)], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob); const link = document.createElement('a');
		try {
			link.href = url; link.download = `meli-history-v1-${archive.exportedAt.slice(0, 10)}.${format}`;
			document.body.append(link); link.click();
		} finally { link.remove(); URL.revokeObjectURL(url); }
		return 'Archivo exportado.';
	}

	const confirmLabel = confirmation?.type === 'import' ? 'Confirmar importaci\u00f3n' : confirmation?.type === 'prune' ? 'Confirmar limpieza' : 'Confirmar borrado';
	const explanation = confirmation?.type === 'import' ? `Combinar ${confirmation.archive.publications.length} publicaciones y ${confirmation.archive.observations.length} capturas. Se conservan los datos actuales. Los duplicados no se agregan.`
		: confirmation?.type === 'prune' ? `Eliminar capturas anteriores a ${new Date(Date.now() - confirmation.days * 86400000).toISOString().slice(0, 19)} UTC y guardar ${confirmation.days} dias como retencion propuesta. No se aplicara automaticamente.`
			: confirmation?.type === 'remove' ? `Eliminar ${confirmation.key} y todas sus capturas. Esta accion no se puede deshacer.`
				: `Eliminar ${info?.publicationCount ?? 0} publicaciones y ${info?.observationCount ?? 0} capturas. Esta accion no se puede deshacer.`;

	return <main className="meli-app app-options">
		<header className="app-toolbar"><div className="brand"><Package size={18} aria-hidden="true" /><strong>MeliExtension</strong></div><h1>Historial propio</h1><button className="icon-button" aria-label="Actualizar historial" data-tooltip="Actualizar historial" disabled={busy} onClick={() => { void run(async () => 'Historial actualizado.'); }}><RefreshCw size={18} aria-hidden="true" /></button></header>
		<section className="history-management" aria-label="Archivos y almacenamiento">
			<div className="history-limits"><span>{info ? `${info.publicationCount} / 100 publicaciones` : 'Hasta 100 publicaciones'}</span><span>{info ? `${info.observationCount} / 50000 capturas` : 'Hasta 50000 capturas'}</span><span>Archivos de hasta 64 MB &middot; Datos locales</span></div>
			<div className="management-controls"><label className="compact-field">Formato<select aria-label="Formato" value={format} onChange={event => setFormat(event.currentTarget.value as 'json' | 'csv')}><option value="json">JSON v1</option><option value="csv">CSV v1</option></select></label>
				<button className="icon-button" aria-label="Exportar historial" data-tooltip="Exportar historial" disabled={busy || !info} onClick={() => { void run(download); }}><Download size={18} aria-hidden="true" /></button>
				<label className={`secondary-button import-control ${busy ? 'is-disabled' : ''}`}><Upload size={16} aria-hidden="true" />Importar archivo<input className="sr-only" type="file" accept=".json,.csv,application/json,text/csv" disabled={busy || !info} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void prepareImport(file); }} /></label>
				<label className="compact-field">Retenci&oacute;n propuesta<select aria-label="Retenci&oacute;n propuesta" disabled={busy || !info} value={info?.retentionDays ?? 90} onChange={event => setConfirmation({ type: 'prune', days: Number(event.currentTarget.value) as 7 | 30 | 90 })}>{[7, 30, 90].map(days => <option key={days} value={days}>{days} d&iacute;as</option>)}</select></label>
				<button className="secondary-button" disabled={busy || !info} onClick={() => setConfirmation({ type: 'prune', days: info?.retentionDays ?? 90 })}><Trash2 size={16} aria-hidden="true" />Limpiar capturas</button>
				<button className="icon-button danger-button" aria-label="Borrar todos los datos" data-tooltip="Borrar todos los datos" disabled={busy || !info} onClick={() => setConfirmation({ type: 'clear' })}><Trash2 size={18} aria-hidden="true" /></button>
			</div><p className="history-coverage">Retenci&oacute;n propuesta: {info?.retentionDays ?? 90} d&iacute;as. Sin limpieza ni seguimiento autom&aacute;ticos.</p>
		</section>
		{error ? <p className="state-message" role="alert">{error}</p> : null}<p className="management-status" role="status">{busy ? 'Procesando' : message}</p>
		<div className="options-layout"><aside className="publication-list" aria-label="Publicaciones guardadas"><h2>Publicaciones</h2>{publications.length ? <ul>{publications.map(item => <li key={item.key}>
			<button className="publication-select" aria-pressed={selected === item.key} onClick={() => setSelected(item.key)}><strong>{item.snapshot.title ?? item.snapshot.listingId ?? item.snapshot.productId}</strong><span>{item.key}</span></button>
			<div className="publication-actions"><a className="icon-button" href={item.snapshot.canonicalUrl} target="_blank" rel="noreferrer" aria-label={`Abrir ${item.key}`} data-tooltip="Abrir publicaci&oacute;n"><ExternalLink size={15} aria-hidden="true" /></a>
				<button className="icon-button" aria-label={`${item.following ? 'Dejar de seguir' : 'Seguir'} ${item.key}`} data-tooltip={item.following ? 'Dejar de seguir' : 'Seguir'} disabled={busy} onClick={() => { void run(async () => { if (item.following) await historyRequest('history.unfollow', { key: item.key }, 'done'); else await historyRequest('history.follow', { snapshot: item.snapshot }, 'done'); return 'Seguimiento actualizado.'; }); }}>{item.following ? <StarOff size={15} aria-hidden="true" /> : <Star size={15} aria-hidden="true" />}</button>
				<button className="icon-button danger-button" aria-label={`Eliminar ${item.key}`} data-tooltip="Eliminar publicaci&oacute;n" disabled={busy} onClick={() => setConfirmation({ type: 'remove', key: item.key })}><Trash2 size={15} aria-hidden="true" /></button></div>
		</li>)}</ul> : <p className="history-status">Sin publicaciones guardadas.</p>}</aside>
			<section className="options-history" aria-label="Consulta sin conexi&oacute;n">{data?.publication ? <HistoryView key={data.publication.key} snapshot={data.publication.snapshot} data={data} chart={(observations, currency) => <ChartBoundary><Suspense fallback={<p role="status">Cargando gr&aacute;fico</p>}><HistoryChart observations={observations} currency={currency} /></Suspense></ChartBoundary>} /> : <p className="history-status">{selected ? 'Cargando publicaci\u00f3n' : 'Sin historial disponible.'}</p>}</section>
		</div>
		<dialog className="confirmation-dialog" ref={dialog} aria-labelledby="confirmation-title" aria-describedby="confirmation-description" onCancel={event => { if (busy) event.preventDefault(); else setConfirmation(null); }} onClose={() => setConfirmation(null)}>
			<h2 id="confirmation-title">{confirmLabel}</h2><p id="confirmation-description">{explanation}</p>{confirmation && error ? <p className="state-message" role="alert">{error}</p> : null}<div className="dialog-actions"><button className="secondary-button" autoFocus disabled={busy} onClick={() => setConfirmation(null)}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => { void run(confirm); }}>{confirmLabel}</button></div>
		</dialog>
	</main>;
}