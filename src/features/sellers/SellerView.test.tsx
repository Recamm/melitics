import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicPageSnapshot } from '../../shared/contracts';
import { marketplaceRequest } from '../../messaging/client';
import { contactCandidate } from './contacts';
import { SellerView } from './SellerView';
vi.mock('../../messaging/client', () => ({ marketplaceRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const snapshot: PublicPageSnapshot = { siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId: 'MLA123456789', productId: null, canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-123456789-prueba', title: 'Fixture', price: null, imageUrl: null, seller: { id: '98765', name: 'Fixture A', url: 'https://www.mercadolibre.com.ar/perfil/FIXTURE_A' }, observedAt: new Date().toISOString(), extractorRevision: 'public-v1', provenance: {} };
describe('explicit public seller contacts', () => {
  it('never saves on mount and persists only through the explicit command', async () => {
    vi.mocked(marketplaceRequest).mockResolvedValue({ kind: 'contacts', contacts: [] });
    const user = userEvent.setup(); render(<SellerView snapshot={snapshot} />);
    await waitFor(() => expect(marketplaceRequest).toHaveBeenCalledWith('sellers.read', { snapshot }, 'contacts'));
    expect(vi.mocked(marketplaceRequest).mock.calls.some(([operation]) => operation === 'sellers.save')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Guardar perfil p\u00fablico' }));
    expect(marketplaceRequest).toHaveBeenCalledWith('sellers.save', { snapshot }, 'done');
  });
  it('does not show seller A contacts after navigating to B during a pending read', async () => {
    let finish!: (value: { kind: 'contacts'; contacts: NonNullable<ReturnType<typeof contactCandidate>>[] }) => void;
    vi.mocked(marketplaceRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ kind: 'contacts', contacts: [] });
    const { rerender } = render(<SellerView snapshot={snapshot} />);
    rerender(<SellerView snapshot={{ ...snapshot, seller: { id: '12345', name: 'Fixture B', url: null } }} />);
    finish({ kind: 'contacts', contacts: [contactCandidate(snapshot)!] });
    await waitFor(() => expect(screen.getByText('Sin contactos guardados')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Perfil guardado' })).toBeNull();
  });
  it('refuses stale saves and does not expose script links', () => {
    render(<SellerView snapshot={{ ...snapshot, seller: { ...snapshot.seller!, url: 'javascript:alert(1)' } }} disabled />);
    expect(screen.queryByRole('link')).toBeNull();
    expect((screen.getByRole('button', { name: 'Guardar perfil p\u00fablico' }) as HTMLButtonElement).disabled).toBe(true);
  });
});