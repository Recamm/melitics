import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, ChevronLeft, ChevronRight, ChartLine, RefreshCw, Star, StarOff } from 'lucide-react';
import { publicationKey, type HistoryData, type Money, type PriceObservation, type PublicPageSnapshot } from '../../shared/contracts';
import { formatMoney } from '../../shared/money';
import { summarizeHistory } from './history';
import type { historyRequest } from '../../messaging/client';

export type HistoryViewProps = {
	snapshot: PublicPageSnapshot | null; disabled?: boolean; data?: HistoryData; onManage?: (key: string | null) => Promise<void>;
	chart?: (observations: PriceObservation[], currency: Money['currency']) => ReactNode;
};
export function utcText(value: string): string { return `${value.slice(0, 19).replace('T', ' ')} UTC`; }
const request: typeof historyRequest = async (...args) => (await import('../../messaging/client')).historyRequest(...args);

export function HistoryView(props: HistoryViewProps) {
	const key = props.snapshot ? publicationKey(props.snapshot) : null;
	const [stored, setStored] = useState<HistoryData>({ publication: null, observations: [] });
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [days, setDays] = useState<7 | 30 | 90>(30);
	const [currency, setCurrency] = useState<Money['currency']>(props.snapshot?.price?.currency ?? 'ARS');
	const [page, setPage] = useState(0);
	const generation = useRef(0);
	const saving = useRef(false);

	useEffect(() => {
		const current = ++generation.current;
		if (!props.data && key) {
			setLoaded(false);
			void request('history.read', { key }, 'data').then(value => {
				if (current === generation.current) { setStored({ publication: value.publication, observations: value.observations }); setLoaded(true); }
			}, failure => { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Historial no disponible.'); });
		}
		return () => { generation.current += 1; };
	}, [key, props.data]);

	const data = props.data ?? stored;
	const summary = summarizeHistory(data.observations, days, currency);
	const latest = data.observations.toSorted((left, right) => left.snapshot.observedAt.localeCompare(right.snapshot.observedAt)).at(-1);
	const currencies = [...new Set([currency, ...summary.currencies])].sort();
	const rows = summary.observations.toReversed().slice(page * 25, (page + 1) * 25);
	const readonly = props.data !== undefined;

	async function act(operation: 'follow' | 'unfollow' | 'capture' | 'refresh' | 'manage'): Promise<void> {
		if (!key || saving.current || readonly) return;
		const current = generation.current;
		saving.current = true; setBusy(true); setError(null); setMessage(null);
		try {
			if (operation === 'manage') { await props.onManage?.(key); return; }
			let status = '';
			if (operation === 'unfollow') { await request('history.unfollow', { key }, 'done'); status = 'Seguimiento detenido. Historial conservado.'; }
			if (operation === 'follow' && props.snapshot) { await request('history.follow', { snapshot: props.snapshot }, 'done'); status = 'Publicaci\u00f3n seguida. Sin capturas autom\u00e1ticas.'; }
			if (operation === 'capture' && props.snapshot) {
				const result = await request('history.capture', { snapshot: props.snapshot }, 'capture');
				status = result.status === 'recorded' ? 'Captura guardada.' : result.status === 'duplicate' ? 'Esta captura ya estaba guardada.' : 'La publicaci\u00f3n no est\u00e1 seguida.';
			}
			const next = await request('history.read', { key }, 'data');
			if (current === generation.current) { setStored({ publication: next.publication, observations: next.observations }); setLoaded(true); setMessage(status); setPage(0); }
		} catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Historial no disponible.'); }
		finally { saving.current = false; if (current === generation.current) setBusy(false); }
	}

	return <section className="history-view" aria-label="Historial propio">
		<div className="fees-heading"><div><h1 tabIndex={-1}>Historial</h1><p>{props.snapshot?.title ?? 'Sin publicaci\u00f3n compatible'}</p></div>
			{!readonly ? <button className="icon-button" aria-label="Actualizar historial" data-tooltip="Actualizar historial" disabled={busy || !key} onClick={() => { void act('refresh'); }}><RefreshCw size={17} aria-hidden="true" /></button> : null}
		</div>
		{!readonly ? <p className="history-status">L&iacute;mites locales: 100 publicaciones &middot; 50000 capturas.</p> : null}
		{!readonly ? <div className="history-actions"><button className="secondary-button" disabled={busy || !loaded || !key || props.disabled} onClick={() => { void act(data.publication?.following ? 'unfollow' : 'follow'); }}>
			{data.publication?.following ? <StarOff size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}{data.publication?.following ? 'Dejar de seguir' : 'Seguir publicaci\u00f3n'}
		</button><button className="icon-button" aria-label="Guardar captura" data-tooltip="Guardar captura" disabled={busy || !loaded || !data.publication?.following || props.disabled} onClick={() => { void act('capture'); }}><Camera size={18} aria-hidden="true" /></button></div> : null}
		{error ? <p className="state-message" role="alert">{error}</p> : null}
		<p className="history-status" role="status">{message ?? (busy ? 'Guardando' : !readonly && key && !loaded && !error ? 'Cargando historial' : `${data.observations.length} capturas guardadas`)}</p>
		<dl className="data-list"><div className="data-row"><dt>&Uacute;ltima captura</dt><dd>{latest ? utcText(latest.snapshot.observedAt) : 'Sin capturas'}</dd></div></dl>
		<div className="history-filters"><label>Per&iacute;odo<select aria-label="Per&iacute;odo" value={days} onChange={event => { setDays(Number(event.currentTarget.value) as 7 | 30 | 90); setPage(0); }}>{[7, 30, 90].map(value => <option key={value} value={value}>{value} d&iacute;as</option>)}</select></label>
			<label>Moneda<select aria-label="Moneda" value={currency} onChange={event => { setCurrency(event.currentTarget.value as Money['currency']); setPage(0); }}>{currencies.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
		<dl className="fees-results"><div className="fee-result"><dt>M&iacute;nimo observado</dt><dd>{summary.minimum ? formatMoney(summary.minimum) : 'No disponible'}</dd></div>
			<div className="fee-result"><dt>M&aacute;ximo observado</dt><dd>{summary.maximum ? formatMoney(summary.maximum) : 'No disponible'}</dd></div>
			<div className="fee-result"><dt>Cambio observado</dt><dd>{summary.change ? formatMoney(summary.change) : 'No calculable'}{summary.changeBps !== null ? ` (${(summary.changeBps / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%)` : ''}</dd></div></dl>
		<p className="history-coverage">{summary.observedDays} d&iacute;as con capturas; {summary.missingDays} sin cobertura. Sin historial anterior inferido.</p>
		{props.chart ? props.chart(summary.observations, currency) : null}
		{props.onManage && key ? <button className="text-link text-link-button" disabled={busy} onClick={() => { void act('manage'); }}><ChartLine size={14} aria-hidden="true" />Gr&aacute;fico y archivos</button> : null}
		<table className="history-table"><caption>Capturas observadas</caption><thead><tr><th scope="col">Fecha UTC</th><th scope="col">Precio</th><th scope="col">Fuente</th></tr></thead><tbody>
			{rows.map(observation => <tr key={observation.id}><td><time dateTime={observation.snapshot.observedAt}>{utcText(observation.snapshot.observedAt)}</time></td><td>{observation.snapshot.price ? `${formatMoney(observation.snapshot.price)} ${observation.snapshot.price.currency}` : 'No disponible'}</td><td><a href={observation.snapshot.provenance.price?.url ?? observation.snapshot.canonicalUrl} target="_blank" rel="noreferrer">{observation.snapshot.provenance.price?.source ?? observation.snapshot.extractorRevision}</a></td></tr>)}
			{!rows.length ? <tr><td colSpan={3}>Sin capturas en este per&iacute;odo.</td></tr> : null}
		</tbody></table>
		{summary.observations.length > 25 ? <div className="history-pagination"><button className="icon-button" aria-label="Capturas anteriores" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} aria-hidden="true" /></button><span>{page + 1} / {Math.ceil(summary.observations.length / 25)}</span><button className="icon-button" aria-label="Capturas siguientes" disabled={(page + 1) * 25 >= summary.observations.length} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} aria-hidden="true" /></button></div> : null}
	</section>;
}