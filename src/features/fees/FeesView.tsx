import { useId, useState } from 'react';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { currencySchema, FEE_FIELDS, type FeeScenario, type Money } from '../../shared/contracts';
import { formatMoney, parseMoney } from '../../shared/money';
import { calculateProfitability } from './calculate';

type Field = typeof FEE_FIELDS[number];
type Draft = { price: string | null } & Record<Exclude<Field, 'price'>, string>;
const labels: Record<Field, string> = {
  price: 'Precio de venta', cost: 'Costo del producto', commissionBps: 'Comisi\u00f3n (%)',
  fixedFee: 'Cargo fijo', shipping: 'Env\u00edo a tu cargo', taxes: 'Impuestos fijos', financing: 'Financiaci\u00f3n fija',
};
const formOrder: Field[] = ['price', 'cost', 'commissionBps', 'fixedFee', 'shipping', 'taxes', 'financing'];
const emptyDraft = (): Draft => ({ price: null, cost: '', commissionBps: '', fixedFee: '', shipping: '', taxes: '', financing: '' });

function inputMoney(money: Money | null): string {
  if (!money) return '';
  const digits = String(money.amountMinor).padStart(money.exponent + 1, '0');
  return money.exponent ? `${digits.slice(0, -money.exponent)},${digits.slice(-money.exponent)}` : digits;
}

function basisPoints(text: string): number | null {
  const value = text.trim();
  if (!/^[0-9]{1,5}(?:,[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split(',');
  const rate = Number(`${whole}${fraction.padEnd(2, '0')}`);
  return rate <= 1000000 ? rate : null;
}

function percent(value: number | null): string {
  if (value === null) return 'No calculable';
  const digits = String(Math.abs(value)).padStart(3, '0');
  const whole = BigInt(digits.slice(0, -2));
  const signed = value < 0 ? whole === 0n ? -0 : -whole : whole;
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .formatToParts(signed).map((part) => part.type === 'fraction' ? digits.slice(-2) : part.value).join('') + '%';
}

export function FeesView({ price, title }: { price: Money | null; title?: string | null }) {
  const id = useId();
  const [currency, setCurrency] = useState<Money['currency']>(price?.currency ?? 'ARS');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editedAt, setEditedAt] = useState(() => new Date().toISOString());
  const values = { ...draft, price: draft.price ?? inputMoney(price?.currency === currency ? price : null) };
  const monetary = (field: Exclude<Field, 'commissionBps'>) => parseMoney(values[field], { currency, locale: 'es-AR', format: 'localized' });
  const input: FeeScenario = {
    currency, price: monetary('price'), cost: monetary('cost'), commissionBps: basisPoints(values.commissionBps),
    fixedFee: monetary('fixedFee'), shipping: monetary('shipping'), taxes: monetary('taxes'), financing: monetary('financing'),
    rules: { source: 'manual', version: 'manual-half-up-v1', observedAt: editedAt },
  };
  const invalid = FEE_FIELDS.filter((field) => values[field].trim() !== '' && input[field] === null);
  const result = invalid.length ? null : calculateProfitability(input);
  const complete = result?.status === 'complete' ? result : null;
  const moneyValue = (money: Money | null | undefined) => money ? formatMoney(money) : 'No calculable';
  const metrics = [
    ['Monto recibido', moneyValue(complete?.payout), 'payout'],
    ['Ganancia neta', moneyValue(complete?.profit), 'profit'],
    ['Margen sobre venta', percent(complete?.marginBps ?? null), 'margin'],
    ['Retorno sobre costo', percent(complete?.returnOnCostBps ?? null), 'return'],
    ['Punto de equilibrio', moneyValue(complete?.breakEven), 'breakEven'],
  ];

  function reset(nextCurrency = price?.currency ?? 'ARS'): void {
    setCurrency(nextCurrency);
    setDraft(emptyDraft());
    setEditedAt(new Date().toISOString());
  }

  return <section className="fees-view" aria-label="Escenario de rentabilidad">
    <header className="fees-heading"><div><h1 tabIndex={-1}>Rentabilidad</h1><p>{title ?? 'Escenario manual'}</p></div>
      <button className="icon-button" aria-label="Restablecer escenario" data-tooltip="Restablecer escenario" onClick={() => reset()}><RotateCcw size={17} aria-hidden="true" /></button>
    </header>
    <div className="fees-reference"><span>Manual</span><span>{draft.price === null && price?.currency === currency ? 'Precio de referencia' : 'Precio manual'}</span></div>
    <div className="fees-form">
      <div className="fee-field"><label htmlFor={`${id}-currency`}>Moneda</label><select id={`${id}-currency`} name="currency" value={currency} onChange={(event) => reset(currencySchema.parse(event.currentTarget.value))}>
        {currencySchema.options.map((code) => <option key={code} value={code}>{code}</option>)}
      </select></div>
      {formOrder.map((field) => <div className="fee-field" key={field}>
        <label htmlFor={`${id}-${field}`}>{labels[field]}</label>
        <input id={`${id}-${field}`} name={field} type="text" inputMode="decimal" autoComplete="off" maxLength={64}
          value={values[field]} aria-invalid={invalid.includes(field)} aria-describedby={invalid.includes(field) ? `${id}-${field}-error` : undefined}
          onChange={(event) => { const value = event.currentTarget.value; setDraft((previous) => ({ ...previous, [field]: value })); setEditedAt(new Date().toISOString()); }} />
        {invalid.includes(field) ? <span className="fee-error" id={`${id}-${field}-error`} role="alert">{field === 'commissionBps' ? 'Porcentaje inv\u00e1lido' : 'Importe inv\u00e1lido'}</span> : null}
      </div>)}
    </div>
    <p className={`fees-state ${complete ? '' : 'warning-text'}`} role="status">{invalid.length ? 'Corregir campos inv\u00e1lidos'
      : result?.status === 'incomplete' ? `${result.missing.length} campos pendientes`
      : result?.status === 'invalid' ? 'Importes fuera de rango' : 'Escenario calculado'}</p>
    <dl className="fees-results">{metrics.map(([label, value, key]) => <div key={key} className={`fee-result ${key === 'profit' ? 'fee-profit' : ''}`}>
      <dt>{label}</dt><dd><output aria-label={label} aria-live="off" data-result={key} className={key === 'profit' && complete && complete.profit.amountMinor < 0 ? 'loss-value' : ''}>{value}</output></dd>
    </div>)}</dl>
    <details className="provenance"><summary>Desglose de cargos</summary><dl className="data-list">
      <div className="data-row"><dt>Comisi&oacute;n</dt><dd>{moneyValue(complete?.commission)}</dd></div>
      {(['fixedFee', 'shipping', 'taxes', 'financing'] as const).map((field) => <div key={field} className="data-row"><dt>{labels[field]}</dt><dd>{input[field] ? formatMoney(input[field]) : 'No disponible'}</dd></div>)}
      <div className="data-row"><dt>Total de cargos</dt><dd>{moneyValue(complete?.deductions)}</dd></div>
    </dl></details>
    <details className="provenance"><summary>Supuestos y fuente</summary><dl className="data-list">
      <div className="data-row"><dt>Fuente</dt><dd>Manual</dd></div>
      <div className="data-row"><dt>Comisi&oacute;n</dt><dd>Sobre precio de venta</dd></div>
      <div className="data-row"><dt>Otros cargos</dt><dd>Importes fijos del escenario</dd></div>
      <div className="data-row"><dt>Equilibrio</dt><dd>Mismos costos y tasas; sin escalones</dd></div>
      <div className="data-row"><dt>Cotizaci&oacute;n oficial</dt><dd>No consultada</dd></div>
      <div className="data-row"><dt>Redondeo</dt><dd>Mitad hacia arriba por cargo</dd></div>
      <div className="data-row"><dt>Versi&oacute;n</dt><dd translate="no">{input.rules.version}</dd></div>
      <div className="data-row"><dt>Fecha</dt><dd><time dateTime={editedAt}>{new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(editedAt))}</time></dd></div>
    </dl></details>
    <footer className="fees-footer"><a className="text-link" href="https://www.mercadolibre.com.ar/simulador-de-costos" target="_blank" rel="noreferrer" title="Cotizaci&oacute;n oficial; puede requerir iniciar sesi&oacute;n">Simulador oficial<ExternalLink size={13} aria-hidden="true" /></a></footer>
  </section>;
}