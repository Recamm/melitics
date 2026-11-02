import { useEffect, useId, useRef, useState } from 'react';
import { Calculator, ExternalLink, History, List, Package, PanelRightOpen, RefreshCw, Settings, Store, X } from 'lucide-react';
import type { PanelState, Preferences } from '../shared/contracts';
import { formatMoney } from '../shared/money';
import { FeesView } from '../features/fees/FeesView';
import { HistoryView } from '../features/history/HistoryView';
import { OffersView } from '../features/catalog/OffersView';
import { SellerView } from '../features/sellers/SellerView';

export type AppProps = {
  state: PanelState;
  mode: 'panel' | 'popup';
  onRefresh: () => void;
  onClose?: () => void;
  onOpen?: () => void;
  preferences?: Preferences;
  onToggle?: (enabled: boolean) => void;
  autoFocus?: boolean;
  onManage?: (key: string | null) => Promise<void>;
};

const sourceNames = { 'json-ld': 'JSON-LD', meta: 'Metadatos', dom: 'P\u00e1gina', url: 'URL' };

export function App(props: AppProps) {
  const { state, mode } = props;
  const snapshot = state.snapshot;
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(false);
  const [view, setView] = useState<'summary' | 'fees' | 'history' | 'market'>('summary');
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [managementError, setManagementError] = useState(false);
  useEffect(() => {
    if (props.autoFocus && !initialFocus.current && title.current) { title.current.focus(); initialFocus.current = true; }
  }, [props.autoFocus, snapshot?.canonicalUrl]);
  const partial = snapshot && (!snapshot.title || !snapshot.price || !snapshot.seller?.name);
  const badge = state.stale ? 'Desactualizados' : state.status === 'loading' ? 'Actualizando'
    : state.status === 'unsupported' ? 'No compatible' : state.status === 'error' ? 'Error de captura' : partial ? 'Datos parciales' : 'Captura actual';
  const image = snapshot?.imageUrl && snapshot.imageUrl !== failedImage ? snapshot.imageUrl : null;
  const feeIdentity = `${snapshot?.listingId ?? snapshot?.productId ?? 'manual'}:${snapshot?.canonicalUrl ?? 'manual'}:${snapshot?.price?.currency ?? 'ARS'}`;

  function selectView(next: 'summary' | 'fees' | 'history' | 'market'): void {
    setView(next);
    tabs.current?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
  }

  return <section className={`meli-app app-${mode}`} aria-label="MeliExtension" onKeyDown={(event) => {
    if (event.key === 'Escape' && props.onClose) { event.preventDefault(); event.stopPropagation(); props.onClose(); }
  }}>
    <header className="app-toolbar">
      <div className="brand" translate="no"><span className="brand-mark"><Package size={17} aria-hidden="true" /></span><strong>MeliExtension</strong></div>
      <div className="toolbar-actions">
        {props.onManage ? <button className="icon-button" aria-label="Gestionar historial" data-tooltip="Gestionar historial" onClick={() => { setManagementError(false); void props.onManage?.(null).catch(() => setManagementError(true)); }}><Settings size={17} aria-hidden="true" /></button> : null}
        <button className="icon-button" aria-label="Actualizar datos" data-tooltip="Actualizar datos" onClick={props.onRefresh}><RefreshCw size={17} aria-hidden="true" /></button>
        {props.onClose ? <button className="icon-button" aria-label="Cerrar panel" data-tooltip="Cerrar panel" onClick={props.onClose}><X size={18} aria-hidden="true" /></button> : null}
      </div>
    </header>
    <div ref={tabs} className="view-tabs" role="tablist" aria-label="Vistas" onKeyDown={(event) => {
      const views = ['summary', 'fees', 'history', 'market'] as const;
      const next = event.key === 'Home' ? 'summary' : event.key === 'End' ? 'market'
        : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? views[(views.indexOf(view) + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length] : null;
      if (next) { event.preventDefault(); selectView(next); }
    }}>
      <button className="view-tab" id={`${titleId}-summary-tab`} role="tab" data-view="summary" aria-selected={view === 'summary'} aria-controls={`${titleId}-summary`} tabIndex={view === 'summary' ? 0 : -1} onClick={() => selectView('summary')}><List size={15} aria-hidden="true" /><span>Resumen</span></button>
      <button className="view-tab" id={`${titleId}-fees-tab`} role="tab" data-view="fees" aria-selected={view === 'fees'} aria-controls={`${titleId}-fees`} tabIndex={view === 'fees' ? 0 : -1} onClick={() => selectView('fees')}><Calculator size={15} aria-hidden="true" /><span>Rentabilidad</span></button>
      <button className="view-tab" id={`${titleId}-history-tab`} role="tab" data-view="history" aria-selected={view === 'history'} aria-controls={`${titleId}-history`} tabIndex={view === 'history' ? 0 : -1} onClick={() => selectView('history')}><History size={15} aria-hidden="true" /><span>Historial</span></button>
      <button className="view-tab" id={`${titleId}-market-tab`} role="tab" data-view="market" aria-selected={view === 'market'} aria-controls={`${titleId}-market`} tabIndex={view === 'market' ? 0 : -1} onClick={() => selectView('market')}><Store size={15} aria-hidden="true" /><span>Mercado</span></button>
    </div>
    <div className="app-scroll">
      <div className="capture-line" role="status"><span className={`status-dot ${state.stale || partial || state.status === 'error' || state.status === 'unsupported' ? 'warning' : ''}`} /><span>{badge}</span><span className="market">MLA</span></div>
      {state.message ? <p className="state-message" role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p> : null}
      {managementError ? <p className="state-message" role="alert">No se pudo abrir la gesti&oacute;n del historial.</p> : null}
      <div id={`${titleId}-summary`} role="tabpanel" aria-labelledby={`${titleId}-summary-tab`} hidden={view !== 'summary'}>
      {snapshot ? <>
        <section className="product-summary" aria-labelledby={titleId}>
          <div className="product-image">{image ? <img src={image} width={56} height={56} alt={snapshot.title ?? 'Producto'} referrerPolicy="no-referrer" onError={() => setFailedImage(image)} /> : <Package size={28} aria-label="Imagen no disponible" />}</div>
          <div className="product-heading"><span className="eyebrow">{snapshot.kind === 'catalog' ? 'Producto de cat\u00e1logo' : 'Publicaci\u00f3n'}</span><h1 id={titleId} ref={title} tabIndex={-1}>{snapshot.title ?? 'T\u00edtulo no disponible'}</h1></div>
        </section>
        <section className="price-band" aria-label="Precio publicado"><span className="field-label">Precio publicado</span><strong className="price-number">{snapshot.price ? formatMoney(snapshot.price) : 'No disponible'}</strong><span className="currency-label">{snapshot.price?.currency ?? 'Moneda no disponible'}</span></section>
        <dl className="data-list">
          <div className="data-row"><dt>Publicaci&oacute;n</dt><dd translate="no">{snapshot.listingId ?? 'No disponible'}</dd></div>
          <div className="data-row"><dt>Cat&aacute;logo</dt><dd translate="no">{snapshot.productId ?? 'No disponible'}</dd></div>
        </dl>
        <section className="seller-section" aria-label="Vendedor"><h2><Store size={15} aria-hidden="true" />Vendedor</h2><strong className="seller-name" translate="no">{snapshot.seller?.name ?? 'No disponible'}</strong><dl className="data-list"><div className="data-row"><dt>ID p&uacute;blico</dt><dd translate="no">{snapshot.seller?.id ?? 'No disponible'}</dd></div></dl>{snapshot.seller?.url ? <a className="text-link" href={snapshot.seller.url} target="_blank" rel="noreferrer">Perfil p&uacute;blico<ExternalLink size={13} aria-hidden="true" /></a> : null}</section>
        <details className="provenance"><summary>Procedencia</summary><table><caption className="sr-only">Origen de los datos p&uacute;blicos</caption><tbody>{Object.entries(snapshot.provenance).map(([field, provenance]) => <tr key={field}><th scope="row">{{ title: 'T\u00edtulo', price: 'Precio', listingId: 'Publicaci\u00f3n', productId: 'Cat\u00e1logo', canonicalUrl: 'Enlace', imageUrl: 'Imagen', 'seller.id': 'ID vendedor', 'seller.name': 'Vendedor', 'seller.url': 'Perfil' }[field] ?? field}</th><td>{provenance ? <a href={provenance.url} target="_blank" rel="noreferrer">{sourceNames[provenance.source]}</a> : null}</td></tr>)}</tbody></table></details>
        <footer className="capture-footer"><span>{new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(snapshot.observedAt))}</span><a href={snapshot.canonicalUrl} target="_blank" rel="noreferrer" aria-label="Abrir publicaci&oacute;n">Publicaci&oacute;n<ExternalLink size={13} aria-hidden="true" /></a></footer>
      </> : <div className="empty-state"><Package size={32} aria-hidden="true" /><p>{state.status === 'loading' ? 'Cargando publicaci\u00f3n' : 'Sin publicaci\u00f3n compatible'}</p></div>}
      </div>
      <div id={`${titleId}-fees`} role="tabpanel" aria-labelledby={`${titleId}-fees-tab`} hidden={view !== 'fees'}>
        <FeesView key={feeIdentity} price={snapshot?.price ?? null} title={snapshot?.title ?? null} />
      </div>
      <div id={`${titleId}-history`} role="tabpanel" aria-labelledby={`${titleId}-history-tab`} hidden={view !== 'history'}>
        {view === 'history' ? <HistoryView key={snapshot?.listingId ?? snapshot?.productId ?? 'none'} snapshot={snapshot} disabled={state.stale || state.status !== 'ready'} {...(props.onManage ? { onManage: props.onManage } : {})} /> : null}
      </div>
      <div id={`${titleId}-market`} role="tabpanel" aria-labelledby={`${titleId}-market-tab`} hidden={view !== 'market'}>
        {view === 'market' ? <><OffersView key={feeIdentity} snapshot={snapshot} disabled={state.stale || state.status !== 'ready'} /><SellerView key={`${feeIdentity}:${snapshot?.seller?.id}`} snapshot={snapshot} disabled={state.stale || state.status !== 'ready'} /></> : null}
      </div>
    </div>
    {mode === 'popup' ? <footer className="popup-controls"><label className="preference"><input type="checkbox" name="panelEnabled" checked={props.preferences?.panelEnabled ?? false} disabled={!props.preferences || !props.onToggle} onChange={(event) => props.onToggle?.(event.currentTarget.checked)} />Panel en publicaciones</label><button className="primary-button" onClick={props.onOpen} disabled={!snapshot || !props.onOpen}><PanelRightOpen size={17} aria-hidden="true" />Abrir panel</button></footer> : null}
  </section>;
}