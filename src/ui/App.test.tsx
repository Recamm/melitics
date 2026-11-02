import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelState } from '../shared/contracts';
import { extractPublicPage } from '../platforms/mercadolibre/extract';
import { App } from './App';

afterEach(cleanup);

function state(name = 'listing'): PanelState {
  const document = new DOMParser().parseFromString(readFileSync(`tests/fixtures/${name}.html`, 'utf8'), 'text/html');
  const result = extractPublicPage(document, 'https://articulo.mercadolibre.com.ar/MLA-123456789-camara-_JM');
  if (result.status === 'unsupported') throw new Error('Invalid fixture');
  return { status: 'ready', snapshot: result.snapshot, stale: false, message: null };
}

describe('public product panel', () => {
  it('shows product, price, seller, IDs and field provenance without session values', () => {
    render(<App state={state()} mode="panel" onRefresh={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Camara de prueba' })).toBeTruthy();
    expect(screen.getByText(/1\.234,56/)).toBeTruthy();
    expect(screen.getByText('TIENDA_PRUEBA')).toBeTruthy();
    expect(screen.getByText('MLA123456789')).toBeTruthy();
    expect(screen.getAllByText('JSON-LD').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('private-');
  });

  it('shows missing fields without claiming a price or seller ID', () => {
    render(<App state={state('incomplete')} mode="panel" onRefresh={vi.fn()} />);
    expect(screen.getByText('Datos parciales')).toBeTruthy();
    expect(screen.getAllByText('No disponible').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Publicacion sin precio' })).toBeTruthy();
  });

  it('refreshes and closes with accessible controls and Escape', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const refresh = vi.fn();
    render(<App state={state()} mode="panel" onRefresh={refresh} onClose={close} autoFocus />);
    await user.click(screen.getByRole('button', { name: 'Actualizar datos' }));
    expect(refresh).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });

  it('marks old data explicitly while a new page loads', () => {
    render(<App state={{ ...state(), status: 'loading', stale: true }} mode="panel" onRefresh={vi.fn()} />);
    expect(screen.getByText('Desactualizados')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Camara de prueba' })).toBeTruthy();
  });

  it('shows a recoverable error and does not hide the refresh control', () => {
    render(<App state={{ status: 'error', snapshot: null, stale: false, message: 'No se pudieron actualizar los datos.' }} mode="panel" onRefresh={vi.fn()} />);
    expect(screen.getByText('Error de captura')).toBeTruthy();
    expect(screen.queryByText('Captura actual')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('No se pudieron actualizar');
    expect(screen.getByRole('button', { name: 'Actualizar datos' })).toBeTruthy();
  });

  it('opens the page panel and changes its preference from the popup', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const toggle = vi.fn();
    render(<App state={state()} mode="popup" onRefresh={vi.fn()} onOpen={open}
      preferences={{ schemaVersion: 1, panelEnabled: true }} onToggle={toggle} />);
    await user.click(screen.getByRole('button', { name: 'Abrir panel' }));
    expect(open).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('checkbox', { name: 'Panel en publicaciones' }));
    expect(toggle).toHaveBeenCalledWith(false);
  });
});