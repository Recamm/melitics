import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyRequest } from '../../messaging/client';
import { observationId, publicationKey, type PublicPageSnapshot } from '../../shared/contracts';
import { HistoryView } from './HistoryView';

vi.mock('../../messaging/client', () => ({ historyRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const snapshot: PublicPageSnapshot = {
  siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId: 'MLA123456789', productId: null,
  canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-123456789-prueba', title: 'Prueba',
  price: { amountMinor: 10000, currency: 'ARS', exponent: 2 }, imageUrl: null, seller: null,
  observedAt: new Date().toISOString(), extractorRevision: 'public-v1', provenance: {},
};

describe('explicit tracking interface', () => {
  it('reads history but never follows or captures just by opening the view', async () => {
    vi.mocked(historyRequest).mockResolvedValue({ kind: 'data', publication: null, observations: [] });
    render(<HistoryView snapshot={snapshot} />);
    await screen.findByRole('button', { name: 'Seguir publicaci\u00f3n' });
    expect(historyRequest).toHaveBeenCalledExactlyOnceWith('history.read', { key: publicationKey(snapshot) }, 'data');
    expect((screen.getByRole('button', { name: 'Guardar captura' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('follows and records only on explicit commands, then reports provenance and UTC', async () => {
    const user = userEvent.setup();
    const publication = { key: publicationKey(snapshot), snapshot, following: true, followedAt: snapshot.observedAt };
    vi.mocked(historyRequest).mockResolvedValue({ kind: 'data', publication: null, observations: [] });
    render(<HistoryView snapshot={snapshot} />);
    await screen.findByRole('button', { name: 'Seguir publicaci\u00f3n' });
    vi.mocked(historyRequest).mockResolvedValue({ kind: 'data', publication, observations: [] });
    await user.click(screen.getByRole('button', { name: 'Seguir publicaci\u00f3n' }));
    await screen.findByRole('button', { name: 'Dejar de seguir' });
    expect(historyRequest).toHaveBeenCalledWith('history.follow', { snapshot }, 'done');
    expect(vi.mocked(historyRequest).mock.calls.some(([operation]) => operation === 'history.capture')).toBe(false);
    vi.mocked(historyRequest).mockImplementation(async (operation) => operation === 'history.capture' ? { kind: 'capture', status: 'recorded' }
      : { kind: 'data', publication, observations: [{ id: observationId(snapshot), publicationKey: publicationKey(snapshot), snapshot }] });
    await user.click(screen.getByRole('button', { name: 'Guardar captura' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Captura guardada'));
    expect(screen.getByRole('table', { name: 'Capturas observadas' }).textContent).toContain('UTC');
  });

  it('does not record stale data and surfaces storage failures without discarding the view', async () => {
    vi.mocked(historyRequest).mockRejectedValue(new Error('Sin espacio. Exporta o elimina datos.'));
    render(<HistoryView snapshot={snapshot} disabled />);
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Guardar captura' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Sin espacio');
  });
});