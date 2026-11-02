import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Save, Store, Trash2 } from 'lucide-react';
import { publicSellerIdSchema, type PublicPageSnapshot, type SellerContact } from '../../shared/contracts';
import { marketplaceRequest } from '../../messaging/client';
import { contactCandidate, contactsForSeller } from './contacts';

export function SellerView({ snapshot, disabled = false }: { snapshot: PublicPageSnapshot | null; disabled?: boolean }) {
	const sellerId = publicSellerIdSchema.safeParse(snapshot?.seller?.id);
	const identity = `${snapshot?.canonicalUrl}:${snapshot?.seller?.id}`;
	const candidate = snapshot ? contactCandidate(snapshot) : null;
	const [loaded, setLoaded] = useState<{ identity: string; contacts: SellerContact[] } | null>(null);
	const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<SellerContact | null>(null);
	const generation = useRef(0); const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const current = ++generation.current; setError(null); setBusy(false); setPending(null);
		if (sellerId.success && snapshot && !disabled) {
			void marketplaceRequest('sellers.read', { snapshot }, 'contacts').then(data => {
				if (generation.current === current) setLoaded({ identity, contacts: data.contacts });
			}, () => { if (generation.current === current) setError('No se pudieron leer los contactos.'); });
		}
		return () => { generation.current += 1; };
	}, [identity, snapshot, disabled]);
	useEffect(() => {
		if (pending && !dialog.current?.open) { dialog.current?.showModal(); dialog.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus(); }
		else if (!pending && dialog.current?.open) dialog.current.close();
	}, [pending]);
	async function command(contact?: SellerContact): Promise<void> {
		if (!snapshot || disabled || busy) return;
		const current = generation.current; setBusy(true); setError(null);
		try {
			if (contact) await marketplaceRequest('sellers.remove', { snapshot, key: contact.key, confirmed: true }, 'done');
			else await marketplaceRequest('sellers.save', { snapshot }, 'done');
			const data = await marketplaceRequest('sellers.read', { snapshot }, 'contacts');
			if (generation.current === current) { setLoaded({ identity, contacts: data.contacts }); setPending(null); }
		} catch (failure) { if (generation.current === current) setError(failure instanceof Error ? failure.message : 'No se pudo guardar el contacto.'); }
		finally { if (generation.current === current) setBusy(false); }
	}
	const contacts = sellerId.success && loaded?.identity === identity ? contactsForSeller(loaded.contacts, sellerId.data) : [];
	return <section className="market-section" aria-label="Contactos del vendedor"><h2><Store size={16} aria-hidden="true" />Contactos del vendedor</h2>
		<dl className="data-list"><div className="data-row"><dt>ID p&uacute;blico</dt><dd>{sellerId.success ? sellerId.data : 'No disponible'}</dd></div></dl>
		<div className="history-actions">{candidate ? <a className="text-link" href={candidate.value} target="_blank" rel="noreferrer">Perfil observado<ExternalLink size={13} aria-hidden="true" /></a> : null}<button className="secondary-button" disabled={!candidate || disabled || busy} onClick={() => { void command(); }}><Save size={15} aria-hidden="true" />Guardar perfil p&uacute;blico</button></div>
		{error ? <p role="alert" className="state-message">{error}</p> : null}<p className="history-status" role="status">{busy ? 'Procesando contacto' : contacts.length ? `${contacts.length} contacto(s) guardado(s)` : 'Sin contactos guardados'}</p>
		{contacts.map(contact => <article className="saved-contact" key={contact.key}><div className="contact-heading"><a className="text-link" href={contact.value} target="_blank" rel="noreferrer">Perfil guardado<ExternalLink size={13} aria-hidden="true" /></a><button className="icon-button danger-button" aria-label="Eliminar contacto" data-tooltip="Eliminar contacto" disabled={disabled || busy} onClick={() => setPending(contact)}><Trash2 size={16} aria-hidden="true" /></button></div><p className="history-coverage">{contact.expired ? 'Vencido' : 'Vigente'} &middot; Identidad no confirmada</p><dl className="data-list"><div className="data-row"><dt>Observado UTC</dt><dd>{contact.observedAt.slice(0, 19)}</dd></div><div className="data-row"><dt>Vence UTC</dt><dd>{contact.expiresAt.slice(0, 19)}</dd></div><div className="data-row"><dt>Procedencia</dt><dd><a href={contact.sourceUrl} target="_blank" rel="noreferrer">Publicaci&oacute;n observada</a></dd></div></dl></article>)}
		<dialog className="confirmation-dialog" ref={dialog} aria-label="Eliminar contacto" onCancel={event => { event.stopPropagation(); if (busy) event.preventDefault(); else setPending(null); }} onClose={() => setPending(null)} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}><h2>Eliminar contacto</h2><p>Eliminar el perfil guardado del vendedor {pending?.sellerId}. Esta acci&oacute;n no se puede deshacer.</p>{pending && error ? <p role="alert" className="state-message">{error}</p> : null}<div className="dialog-actions"><button className="secondary-button" data-cancel disabled={busy} onClick={() => setPending(null)}>Cancelar</button><button className="primary-button" disabled={busy || disabled} onClick={() => { if (pending) void command(pending); }}>Confirmar borrado</button></div></dialog>
	</section>;
}