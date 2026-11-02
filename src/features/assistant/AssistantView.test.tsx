import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicPageSnapshot } from '../../shared/contracts';
import { buildAssistantRequest } from './client';
import { AssistantView } from './AssistantView';
afterEach(cleanup);
const snapshot: PublicPageSnapshot = { siteId: 'MLA', locale: 'es-AR', kind: 'listing', listingId: 'MLA123456789', productId: null, canonicalUrl: 'https://articulo.mercadolibre.com.ar/MLA-123456789-prueba', title: 'Camara de prueba', price: null, imageUrl: null, seller: null, observedAt: '2026-11-01T12:00:00.000Z', extractorRevision: 'public-v1', provenance: {} };
function review(text = 'Camara de prueba revisada') {
  const request = buildAssistantRequest(snapshot, 'title');
  return { request, proposal: { schemaVersion: 1, requestId: request.requestId, task: 'title', title: { text, sources: [] }, description: null, attributes: [] } };
}
describe('disabled assistant and safe local proposal review', () => {
  it.each(['description', 'attributes'] as const)('reviews and manually copies %s without inventing an original value', async task => {
    const user = userEvent.setup(); const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const request = buildAssistantRequest(snapshot, task); const text = 'Texto de prueba local';
    const proposal = { schemaVersion: 1, requestId: request.requestId, task, title: null, description: task === 'description' ? { text, sources: [] } : null,
      attributes: task === 'attributes' ? [{ name: 'Modelo', value: { text, sources: [] } }] : [] };
    render(<AssistantView snapshot={snapshot} review={{ request, proposal }} />);
    expect(screen.getByText('No capturado')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: task === 'description' ? 'Copiar descripci\u00f3n' : 'Copiar atributo Modelo' }));
    expect(copy).toHaveBeenCalledExactlyOnceWith(text);
  });

  it('shows approved no-provider policy and never enables consent or generation', () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); render(<AssistantView snapshot={snapshot} />);
    expect(screen.getByText('Asistencia desactivada')).toBeTruthy(); expect(screen.getByText('USD 0')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Generar propuesta' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Consentimiento de env\u00edo' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('renders text differences without executing HTML and copies only on a manual gesture', async () => {
    const user = userEvent.setup(); const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const text = '<img src=x onerror="alert(1)"> Propuesta local de prueba';
    render(<AssistantView snapshot={snapshot} review={review(text)} />);
    expect(document.querySelector('del')?.textContent).toBe(snapshot.title);
    expect(document.querySelector('ins')?.textContent).toBe(text); expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Sin fuente \u00b7 No verificado')).toBeTruthy(); expect(copy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copiar t\u00edtulo' })); expect(copy).toHaveBeenCalledExactlyOnceWith(text);
  });
  it('surfaces clipboard errors without discarding the proposal or retrying automatically', async () => {
    const user = userEvent.setup(); const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('fixture denied', 'NotAllowedError'));
    render(<AssistantView snapshot={snapshot} review={review()} />); await user.click(screen.getByRole('button', { name: 'Copiar t\u00edtulo' }));
    await screen.findByRole('alert'); expect(copy).toHaveBeenCalledOnce(); expect(document.querySelector('ins')).toBeTruthy();
  });
  it('refuses mismatched captures, invalid output and stale copies, including a late clipboard completion', async () => {
    const user = userEvent.setup(); let finish!: () => void;
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const value = review(); const { rerender } = render(<AssistantView snapshot={snapshot} review={value} />);
    await user.click(screen.getByRole('button', { name: 'Copiar t\u00edtulo' }));
    rerender(<AssistantView snapshot={{ ...snapshot, observedAt: '2026-11-01T13:00:00.000Z' }} review={value} />);
    finish(); await waitFor(() => expect(screen.queryByText('Texto copiado.')).toBeNull());
    expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull();
    rerender(<AssistantView snapshot={snapshot} review={{ ...value, proposal: { ...value.proposal, tools: ['publish'] } }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(<AssistantView snapshot={snapshot} review={value} disabled />);
    expect((screen.getByRole('button', { name: 'Copiar t\u00edtulo' }) as HTMLButtonElement).disabled).toBe(true);
  });
});