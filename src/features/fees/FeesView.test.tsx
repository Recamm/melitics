import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Money } from '../../shared/contracts';
import { FeesView } from './FeesView';

afterEach(cleanup);
const price: Money = { amountMinor: 10000, currency: 'ARS', exponent: 2 };

async function fill(user: ReturnType<typeof userEvent.setup>) {
  for (const [name, value] of [
    ['Costo del producto', '40'], ['Comisi\u00f3n (%)', '10'], ['Cargo fijo', '2'],
    ['Env\u00edo a tu cargo', '5'], ['Impuestos fijos', '3'], ['Financiaci\u00f3n fija', '0'],
  ]) await user.type(screen.getByLabelText(name!), value!);
}

describe('manual fees view', () => {
  it('seeds only the known price and leaves charges missing instead of assuming zero', () => {
    render(<FeesView price={price} />);
    expect((screen.getByLabelText('Precio de venta') as HTMLInputElement).value).toBe('100,00');
    expect((screen.getByLabelText('Costo del producto') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Ganancia neta').textContent).toBe('No calculable');
    expect(screen.getByText(/campos pendientes/)).toBeTruthy();
  });

  it('calculates the manual scenario and exposes its provenance and official simulator link', async () => {
    const user = userEvent.setup();
    render(<FeesView price={price} />);
    await fill(user);
    expect(screen.getByLabelText('Monto recibido').textContent).toBe('$\u00a080,00');
    expect(screen.getByLabelText('Ganancia neta').textContent).toBe('$\u00a040,00');
    expect(screen.getByLabelText('Margen sobre venta').textContent).toBe('40,00%');
    expect(screen.getByLabelText('Retorno sobre costo').textContent).toBe('100,00%');
    expect(screen.getByText('manual-half-up-v1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Simulador oficial' }).getAttribute('href')).toBe('https://www.mercadolibre.com.ar/simulador-de-costos');
  });

  it('shows a loss and keeps undefined return and break-even distinct from zero', async () => {
    const user = userEvent.setup();
    render(<FeesView price={price} />);
    await fill(user);
    await user.clear(screen.getByLabelText('Costo del producto'));
    await user.type(screen.getByLabelText('Costo del producto'), '90');
    expect(screen.getByLabelText('Ganancia neta').textContent).toBe('-$\u00a010,00');
    await user.clear(screen.getByLabelText('Costo del producto'));
    await user.type(screen.getByLabelText('Costo del producto'), '0');
    expect(screen.getByLabelText('Retorno sobre costo').textContent).toBe('No calculable');
    await user.clear(screen.getByLabelText('Comisi\u00f3n (%)'));
    await user.type(screen.getByLabelText('Comisi\u00f3n (%)'), '100');
    expect(screen.getByLabelText('Punto de equilibrio').textContent).toBe('No calculable');
  });

  it('does not compute an exact result for invalid or cleared money', async () => {
    const user = userEvent.setup();
    render(<FeesView price={price} />);
    await fill(user);
    await user.clear(screen.getByLabelText('Costo del producto'));
    await user.type(screen.getByLabelText('Costo del producto'), '-1');
    expect(screen.getByLabelText('Costo del producto').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Ganancia neta').textContent).toBe('No calculable');
    await user.clear(screen.getByLabelText('Costo del producto'));
    expect(screen.getByText(/campos pendientes/)).toBeTruthy();
  });

  it('clears currency-dependent values instead of inventing a conversion', async () => {
    const user = userEvent.setup();
    render(<FeesView price={price} />);
    await fill(user);
    await user.selectOptions(screen.getByLabelText('Moneda'), 'CLP');
    expect((screen.getByLabelText('Precio de venta') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Costo del producto') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Ganancia neta').textContent).toBe('No calculable');
  });

  it('preserves a manual price on reference refresh and resets on explicit command', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FeesView price={price} />);
    await user.clear(screen.getByLabelText('Precio de venta'));
    await user.type(screen.getByLabelText('Precio de venta'), '95');
    rerender(<FeesView price={{ ...price, amountMinor: 12000 }} />);
    expect((screen.getByLabelText('Precio de venta') as HTMLInputElement).value).toBe('95');
    await user.click(screen.getByRole('button', { name: 'Restablecer escenario' }));
    expect((screen.getByLabelText('Precio de venta') as HTMLInputElement).value).toBe('120,00');
    expect((screen.getByLabelText('Costo del producto') as HTMLInputElement).value).toBe('');
  });
});