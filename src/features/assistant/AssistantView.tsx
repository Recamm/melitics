import { useEffect, useRef, useState } from 'react';
import { Copy, Sparkles } from 'lucide-react';
import { historySnapshotSchema, type PublicPageSnapshot } from '../../shared/contracts';
import { ASSISTANT_POLICY, validateAssistantProposal, validateAssistantRequest, type AssistantProposal, type AssistantTask, type AssistantText } from './client';

export function AssistantView({ snapshot, disabled = false, review }: { snapshot: PublicPageSnapshot | null; disabled?: boolean; review?: { request: unknown; proposal: unknown } }) {
	const [task, setTask] = useState<AssistantTask>('title');
	const [tone, setTone] = useState('neutral');
	const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle');
	const generation = useRef(0);
	const identity = `${snapshot?.canonicalUrl}:${snapshot?.listingId}:${snapshot?.productId}:${snapshot?.observedAt}:${snapshot?.title}`;
	useEffect(() => { generation.current += 1; setCopyState('idle'); return () => { generation.current += 1; }; }, [identity, review]);
	let proposal: AssistantProposal | null = null;
	let invalid = false;
	if (review) {
		try {
			const current = historySnapshotSchema.parse(snapshot); const request = validateAssistantRequest(review.request);
			if (request.product.canonicalUrl !== current.canonicalUrl || request.product.listingId !== current.listingId || request.product.productId !== current.productId
				|| request.product.observedAt !== current.observedAt || request.product.title !== current.title?.trim()) throw new Error('Capture mismatch');
			proposal = validateAssistantProposal(review.proposal, request);
		} catch { invalid = true; }
	}
	async function copy(text: string): Promise<void> {
		if (disabled || !proposal || copyState === 'pending') return;
		const current = generation.current; setCopyState('pending');
		try { await navigator.clipboard.writeText(text); if (generation.current === current) setCopyState('copied'); }
		catch { if (generation.current === current) setCopyState('error'); }
	}
	const fields: { key: string; label: string; original: string | null; proposed: AssistantText }[] = [];
	if (proposal?.title) fields.push({ key: 'title', label: 't\u00edtulo', original: snapshot?.title ?? null, proposed: proposal.title });
	if (proposal?.description) fields.push({ key: 'description', label: 'descripci\u00f3n', original: null, proposed: proposal.description });
	for (const attribute of proposal?.attributes ?? []) fields.push({ key: `attribute:${attribute.name}`, label: `atributo ${attribute.name}`, original: null, proposed: attribute.value });
	return <section className="market-section assistant-view" aria-label="Asistencia de IA">
		<h2><Sparkles size={16} aria-hidden="true" />Asistencia de IA</h2>
		<p className="history-status" role="status">Asistencia desactivada</p>
		<dl className="data-list"><div className="data-row"><dt>Proveedor</dt><dd>No configurado</dd></div><div className="data-row"><dt>Presupuesto mensual</dt><dd>USD {ASSISTANT_POLICY.monthlyBudgetUsd}</dd></div><div className="data-row"><dt>Alojamiento</dt><dd>Solo local</dd></div><div className="data-row"><dt>Datos enviados</dt><dd>Ninguno</dd></div></dl>
		<div className="market-controls"><label className="compact-field">Tarea<select aria-label="Tarea de asistencia" value={task} disabled={!snapshot || disabled} onChange={event => setTask(event.currentTarget.value as AssistantTask)}><option value="title">T&iacute;tulo</option><option value="description">Descripci&oacute;n</option><option value="attributes">Atributos</option></select></label><label className="compact-field">Tono<select aria-label="Tono de propuesta" value={tone} disabled={!snapshot || disabled} onChange={event => setTone(event.currentTarget.value)}><option value="neutral">Neutral</option><option value="concise">Conciso</option></select></label></div>
		<label className="preference assistant-consent"><input type="checkbox" aria-label="Consentimiento de env&iacute;o" checked={false} disabled readOnly />Autorizar env&iacute;o</label>
		<button className="secondary-button assistant-generate" disabled><Sparkles size={15} aria-hidden="true" />Generar propuesta</button>
		{invalid ? <p className="state-message" role="alert">Propuesta no v&aacute;lida para esta captura.</p> : null}
		{fields.map(field => <section key={field.key} className="assistant-proposal" aria-label={`Propuesta de ${field.label}`}><div className="contact-heading"><h3>Propuesta de {field.label}</h3><button className="icon-button" aria-label={`Copiar ${field.label}`} data-tooltip={`Copiar ${field.label}`} disabled={disabled || copyState === 'pending'} onClick={() => { void copy(field.proposed.text); }}><Copy size={16} aria-hidden="true" /></button></div>
			<p className="history-coverage">{field.proposed.sources.length ? 'Con referencia \u00b7 No verificado' : 'Sin fuente \u00b7 No verificado'}</p>
			<dl className="assistant-diff"><div><dt>Actual</dt><dd>{field.original === null ? 'No capturado' : field.original === field.proposed.text ? field.original : <del>{field.original}</del>}</dd></div><div><dt>Propuesta</dt><dd>{field.original === field.proposed.text ? field.proposed.text : <ins>{field.proposed.text}</ins>}</dd></div></dl>
			{field.proposed.sources.map(url => <a className="text-link" key={url} href={url} target="_blank" rel="noreferrer">Publicaci&oacute;n de referencia</a>)}
		</section>)}
		{!invalid && fields.length ? copyState === 'error' ? <p className="state-message" role="alert">No se pudo copiar el texto. La propuesta se conserva.</p> : <p className="history-status" role="status">{copyState === 'pending' ? 'Copiando texto' : copyState === 'copied' ? 'Texto copiado.' : 'Sin publicaci\u00f3n autom\u00e1tica'}</p> : null}
	</section>;
}