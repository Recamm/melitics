import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Package, PanelRightOpen, RefreshCw, Store, X } from 'lucide-react';
import type { Money, PanelState, Preferences } from '../shared/contracts';

export type AppProps = {
  state: PanelState;
  mode: 'panel' | 'popup';
  onRefresh: () => void;
  onClose?: () => void;
  onOpen?: () => void;
  preferences?: Preferences;
  onToggle?: (enabled: boolean) => void;
  autoFocus?: boolean;
};

function displayMoney(money: Money): string {
  const digits = String(money.amountMinor).padStart(money.exponent + 1, '0');
  const whole = money.exponent ? digits.slice(0, -money.exponent) : digits;
  const fraction = money.exponent ? digits.slice(-money.exponent) : '';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: money.currency })
    .formatToParts(BigInt(whole)).map((part) => part.type === 'fraction' ? fraction : part.value).join('');
}

const sourceNames = { 'json-ld': 'JSON-LD', meta: 'Metadatos', dom: 'P\u00e1gina', url: 'URL' };

export function App(props: AppProps) {
  const { state, mode } = props;
  const snapshot = state.snapshot;
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  useEffect(() => { if (props.autoFocus) title.current?.focus(); }, [props.autoFocus]);
  const partial = snapshot && (!snapshot.title || !snapshot.price || !snapshot.seller?.name);
  const badge = state.stale ? 'Desactualizados' : state.status === 'loading' ? 'Actualizando'
    : state.status === 'unsupported' ? 'No compatible' : state.status === 'error' ? 'Error de captura' : partial ? 'Datos parciales' : 'Captura actual';
  const image = snapshot?.imageUrl && snapshot.imageUrl !== failedImage ? snapshot.imageUrl : null;

  return <section className={`meli-app app-${mode}`} aria-label="MeliExtension" onKeyDown={(event) => {
    if (event.key === 'Escape' && props.onClose) { event.preventDefault(); event.stopPropagation(); props.onClose(); }
  }}>
    <header className="app-toolbar">
      <div className="brand" translate="no"><span className="brand-mark"><Package size={17} aria-hidden="true" /></span><strong>MeliExtension</strong></div>
      <div className="toolbar-actions">
        <button className="icon-button" aria-label="Actualizar datos" data-tooltip="Actualizar datos" onClick={props.onRefresh}><RefreshCw size={17} aria-hidden="true" /></button>
        {props.onClose ? <button className="icon-button" aria-label="Cerrar panel" data-tooltip="Cerrar panel" onClick={props.onClose}><X size={18} aria-hidden="true" /></button> : null}
      </div>
    </header>
    <div className="app-scroll">
      <div className="capture-line" role="status"><span className={`status-dot ${state.stale || partial || state.status === 'error' || state.status === 'unsupported' ? 'warning' : ''}`} /><span>{badge}</span><span className="market">MLA</span></div>
      {state.message ? <p className="state-message" role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p> : null}
      {snapshot ? <>
        <section className="product-summary" aria-labelledby={titleId}>
          <div className="product-image">{image ? <img src={image} width={56} height={56} alt={snapshot.title ?? 'Producto'} referrerPolicy="no-referrer" onError={() => setFailedImage(image)} /> : <Package size={28} aria-label="Imagen no disponible" />}</div>
          <div className="product-heading"><span className="eyebrow">{snapshot.kind === 'catalog' ? 'Producto de cat\u00e1logo' : 'Publicaci\u00f3n'}</span><h1 id={titleId} ref={title} tabIndex={-1}>{snapshot.title ?? 'T\u00edtulo no disponible'}</h1></div>
        </section>
        <section className="price-band" aria-label="Precio publicado"><span className="field-label">Precio publicado</span><strong className="price-number">{snapshot.price ? displayMoney(snapshot.price) : 'No disponible'}</strong><span className="currency-label">{snapshot.price?.currency ?? 'Moneda no disponible'}</span></section>
        <dl className="data-list">
          <div className="data-row"><dt>Publicaci&oacute;n</dt><dd translate="no">{snapshot.listingId ?? 'No disponible'}</dd></div>
          <div className="data-row"><dt>Cat&aacute;logo</dt><dd translate="no">{snapshot.productId ?? 'No disponible'}</dd></div>
        </dl>
        <section className="seller-section" aria-label="Vendedor"><h2><Store size={15} aria-hidden="true" />Vendedor</h2><strong className="seller-name" translate="no">{snapshot.seller?.name ?? 'No disponible'}</strong><dl className="data-list"><div className="data-row"><dt>ID p&uacute;blico</dt><dd translate="no">{snapshot.seller?.id ?? 'No disponible'}</dd></div></dl>{snapshot.seller?.url ? <a className="text-link" href={snapshot.seller.url} target="_blank" rel="noreferrer">Perfil p&uacute;blico<ExternalLink size={13} aria-hidden="true" /></a> : null}</section>
        <details className="provenance"><summary>Procedencia</summary><table><caption className="sr-only">Origen de los datos p&uacute;blicos</caption><tbody>{Object.entries(snapshot.provenance).map(([field, provenance]) => <tr key={field}><th scope="row">{{ title: 'T\u00edtulo', price: 'Precio', listingId: 'Publicaci\u00f3n', productId: 'Cat\u00e1logo', canonicalUrl: 'Enlace', imageUrl: 'Imagen', 'seller.id': 'ID vendedor', 'seller.name': 'Vendedor', 'seller.url': 'Perfil' }[field] ?? field}</th><td>{provenance ? <a href={provenance.url} target="_blank" rel="noreferrer">{sourceNames[provenance.source]}</a> : null}</td></tr>)}</tbody></table></details>
        <footer className="capture-footer"><span>{new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(snapshot.observedAt))}</span><a href={snapshot.canonicalUrl} target="_blank" rel="noreferrer" aria-label="Abrir publicaci&oacute;n">Publicaci&oacute;n<ExternalLink size={13} aria-hidden="true" /></a></footer>
      </> : <div className="empty-state"><Package size={32} aria-hidden="true" /><p>{state.status === 'loading' ? 'Cargando publicaci\u00f3n' : 'Sin publicaci\u00f3n compatible'}</p></div>}
    </div>
    {mode === 'popup' ? <footer className="popup-controls"><label className="preference"><input type="checkbox" name="panelEnabled" checked={props.preferences?.panelEnabled ?? false} disabled={!props.preferences || !props.onToggle} onChange={(event) => props.onToggle?.(event.currentTarget.checked)} />Panel en publicaciones</label><button className="primary-button" onClick={props.onOpen} disabled={!snapshot || !props.onOpen}><PanelRightOpen size={17} aria-hidden="true" />Abrir panel</button></footer> : null}
  </section>;
}