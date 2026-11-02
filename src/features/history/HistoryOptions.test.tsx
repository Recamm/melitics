import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyRequest } from '../../messaging/client';
import { HistoryOptions } from './HistoryOptions';

vi.mock('../../messaging/client', () => ({ historyRequest: vi.fn() }));
vi.mock('./HistoryChart', () => ({ default: () => <div role="img" aria-label="Precios observados" /> }));
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  vi.mocked(historyRequest).mockImplementation(async operation => {
    if (operation === 'history.list') return { kind: 'list', publications: [] };
    if (operation === 'history.info') return { kind: 'info', publicationCount: 0, observationCount: 0, publicationLimit: 100, observationLimit: 50000, retentionDays: 90 };
    return { kind: 'done' };
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('history management confirmation boundaries', () => {
  it('keeps a failed import recoverable and exposes the error inside the active modal', async () => {
    const user = userEvent.setup(); render(<HistoryOptions />);
    await screen.findByText(/0 \/ 100 publicaciones/);
    const text = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), publications: [], observations: [] });
    const file = new File([text], 'fixture.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => text });
    await user.upload(screen.getByLabelText('Importar archivo'), file);
    const modal = await screen.findByRole('dialog');
    vi.mocked(historyRequest).mockRejectedValueOnce(new Error('Sin espacio. Exporta o elimina datos.'));
    await user.click(screen.getByRole('button', { name: 'Confirmar importaci\u00f3n' }));
    expect((await within(modal).findByRole('alert')).textContent).toContain('Sin espacio');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('shows limits and requires confirmation before clearing any stored data', async () => {
    const user = userEvent.setup(); render(<HistoryOptions />);
    await screen.findByText(/0 \/ 100 publicaciones/);
    await user.click(screen.getByRole('button', { name: 'Borrar todos los datos' }));
    expect(vi.mocked(historyRequest).mock.calls.some(([operation]) => operation === 'history.clear')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(vi.mocked(historyRequest).mock.calls.some(([operation]) => operation === 'history.clear')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Borrar todos los datos' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar borrado' }));
    expect(historyRequest).toHaveBeenCalledWith('history.clear', { confirmed: true }, 'done');
  });

  it('rejects an invalid import without issuing a worker mutation', async () => {
    const user = userEvent.setup(); render(<HistoryOptions />);
    await screen.findByText(/0 \/ 100 publicaciones/);
    const file = new File(['{"schemaVersion":99}'], 'fixture.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => '{"schemaVersion":99}' });
    await user.upload(screen.getByLabelText('Importar archivo'), file);
    await screen.findByText('Archivo no valido. No se modificaron los datos.');
    expect(vi.mocked(historyRequest).mock.calls.some(([operation]) => operation === 'history.import')).toBe(false);
  });

  it('confirms the retention change instead of deleting immediately on selection', async () => {
    const user = userEvent.setup(); render(<HistoryOptions />);
    await screen.findByText(/0 \/ 100 publicaciones/);
    await user.selectOptions(screen.getByLabelText('Retenci\u00f3n propuesta'), '7');
    expect(vi.mocked(historyRequest).mock.calls.some(([operation]) => operation === 'history.prune')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirmar limpieza' }));
    expect(historyRequest).toHaveBeenCalledWith('history.prune', { days: 7, confirmed: true }, 'pruned');
  });
});