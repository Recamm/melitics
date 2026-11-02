import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import fixture from '../../tests/fixtures/listing.html?raw';
import incomplete from '../../tests/fixtures/incomplete.html?raw';
import { extractPublicPage } from '../platforms/mercadolibre/extract';
import type { PanelState } from '../shared/contracts';
import { App } from './App';
import './styles.css';

function Preview() {
  const [enabled, setEnabled] = useState(true);
  const [revision, setRevision] = useState(0);
  const selected = new URLSearchParams(location.search).get('state') ?? 'ready';
  const result = extractPublicPage(new DOMParser().parseFromString(selected === 'partial' ? incomplete : fixture, 'text/html'), 'https://articulo.mercadolibre.com.ar/MLA-123456789-camara-_JM');
  if (result.status === 'unsupported') return null;
  const ready: PanelState = { status: 'ready', snapshot: result.snapshot, stale: false, message: null };
  const states: Record<string, PanelState> = {
    ready, partial: ready,
    loading: { status: 'loading', snapshot: null, stale: false, message: null },
    stale: { ...ready, status: 'loading', stale: true },
    error: { status: 'error', snapshot: null, stale: false, message: 'No se pudieron actualizar los datos.' },
    unsupported: { status: 'unsupported', snapshot: null, stale: false, message: 'Publicaci\u00f3n no compatible.' },
  };
  return <main style={{ padding: '20px 0', display: 'grid', justifyItems: 'center', gap: 12 }}>
    <p style={{ font: '12px IBM Plex Sans, sans-serif', color: '#526065', margin: 0 }}>Vista de prueba | Fixture</p>
    <App key={revision} state={states[selected] ?? ready} mode="popup"
      preferences={{ schemaVersion: 1, panelEnabled: enabled }} onToggle={setEnabled}
      onRefresh={() => setRevision((value) => value + 1)} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);