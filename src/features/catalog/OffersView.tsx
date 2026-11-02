import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { PublicPageSnapshot, MarketplaceResult, Money, PaymentSegment } from '../../shared/contracts';
import { formatMoney } from '../../shared/money';
import { createMarketplaceService } from '../../services/marketplace';
import { compareOffers, summarizeBuybox } from './catalog';

const segments = { direct: 'Pago directo', 'installments-interest-free': 'Cuotas sin inter\u00e9s', 'installments-with-interest': 'Cuotas con inter\u00e9s', unknown: 'Condiciones incompletas' };
export function OffersView(props: { snapshot: PublicPageSnapshot | null; result?: MarketplaceResult; disabled?: boolean }) {
	const { snapshot } = props; const productId = snapshot?.productId;
	const [loaded, setLoaded] = useState<{ productId: string; result: MarketplaceResult } | null>(null);
	const [error, setError] = useState(false);
	const [days, setDays] = useState<7 | 30 | 90>(30);
	const [currency, setCurrency] = useState<Money['currency']>(snapshot?.price?.currency ?? 'ARS');
	const [segment, setSegment] = useState<Exclude<PaymentSegment, 'unknown'>>('direct');
	useEffect(() => {
		if (!productId || props.result || props.disabled) return;
		const controller = new AbortController(); setError(false);
		void createMarketplaceService().offers(productId, controller.signal).then(result => {
			if (!controller.signal.aborted) setLoaded({ productId, result });
		}, () => { if (!controller.signal.aborted) setError(true); });
		return () => controller.abort();
	}, [productId, props.result, props.disabled]);
	const result = props.result ?? (loaded?.productId === productId ? loaded?.result ?? null : null);
	const ready = result?.status === 'ready' && productId;
	const groups = ready ? compareOffers(result.offers, productId) : [];
	const summary = ready && snapshot?.listingId ? summarizeBuybox(result.buybox, { productId, listingId: snapshot.listingId, currency, segment, days }) : null;
	return <section className="market-section" aria-label="Cat\u00e1logo y Buybox">
		<h2><BarChart3 size={16} aria-hidden="true" />Cat&aacute;logo y Buybox</h2>
		<dl className="data-list"><div className="data-row"><dt>Cat&aacute;logo</dt><dd>{productId ?? 'No asociado'}</dd></div><div className="data-row"><dt>Fuente de ofertas</dt><dd>{ready ? result.sourceId : 'No disponible'}</dd></div></dl>
		{props.disabled ? <p className="history-status">Datos desactualizados</p> : error ? <p role="alert" className="state-message">No se pudo consultar el cat&aacute;logo.</p> : !productId ? <p className="history-status">Sin cat&aacute;logo asociado</p> : !result ? <p className="history-status" role="status">Consultando disponibilidad</p> : !ready ? <p className="history-status" role="status">Sin fuente autorizada</p> : <>
			{groups.length ? groups.map(group => <section className="offer-group" key={group.key}>
				<h3>{segments[group.segment]}</h3><p className="history-coverage">M&iacute;nimo comparable: {group.minimum ? formatMoney(group.minimum) : 'No disponible'}</p>
				<div className="history-table-wrap"><table className="offers-table"><caption className="sr-only">Ofertas observadas</caption><thead><tr><th>Vendedor</th><th>Total sin env&iacute;o</th><th>Estado observado</th><th>Condiciones y fuente</th></tr></thead><tbody>{group.offers.map(offer => <tr key={offer.listingId}>
					<th scope="row">{offer.sellerName ?? 'No disponible'}<small>{offer.listingId}</small></th><td>{offer.installments.count === 1 && offer.price ? formatMoney(offer.price) : offer.installments.total ? formatMoney(offer.installments.total) : 'No disponible'}</td>
					<td>{offer.winner === true ? <strong>Ganador observado</strong> : offer.winner === false ? 'No ganador' : 'Ganador no informado'}{group.minimumListingIds.includes(offer.listingId) ? <small>M&iacute;nimo comparable</small> : null}</td>
					<td>{offer.installments.count ?? '?'} pago(s) &middot; Full {offer.shipping.full === null ? '?' : offer.shipping.full ? 's\u00ed' : 'no'} &middot; Env&iacute;o {offer.shipping.free === true ? 'gratis' : offer.shipping.cost ? formatMoney(offer.shipping.cost) : 'no informado'}<a href={offer.source.url} target="_blank" rel="noreferrer">{offer.source.observedAt.slice(0, 19)} UTC</a></td>
				</tr>)}</tbody></table></div>
			</section>) : <p className="history-status">Sin ofertas en la fuente autorizada</p>}
			<div className="market-controls"><label className="compact-field">Periodo<select aria-label="Periodo Buybox" value={days} onChange={event => setDays(Number(event.currentTarget.value) as 7 | 30 | 90)}>{[7, 30, 90].map(value => <option key={value} value={value}>{value} d&iacute;as</option>)}</select></label><label className="compact-field">Moneda<select aria-label="Moneda Buybox" value={currency} onChange={event => setCurrency(event.currentTarget.value as Money['currency'])}>{['ARS', 'BRL', 'CLP', 'USD'].map(value => <option key={value}>{value}</option>)}</select></label><label className="compact-field">Pago<select aria-label="Segmento Buybox" value={segment} onChange={event => setSegment(event.currentTarget.value as typeof segment)}>{Object.entries(segments).filter(([key]) => key !== 'unknown').map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div>
			<dl className="data-list"><div className="data-row"><dt>Capturas ganadas</dt><dd>{summary?.winBps != null ? `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(summary.winBps / 100)} %` : 'No disponible'}</dd></div><div className="data-row"><dt>Ganador conocido / desconocido</dt><dd>{summary ? `${summary.knownSamples} / ${summary.unknownSamples}` : 'No disponible'}</dd></div><div className="data-row"><dt>D&iacute;as observados</dt><dd>{summary?.observedDays ?? 0} / {days}</dd></div><div className="data-row"><dt>Ventana observada UTC</dt><dd>{summary?.firstAt ? `${summary.firstAt.slice(0, 19)} / ${summary.lastAt?.slice(0, 19)}` : 'No disponible'}</dd></div></dl>
			{!summary?.knownSamples ? <p className="history-status">Sin capturas con ganador conocido</p> : null}
		</>}
	</section>;
}