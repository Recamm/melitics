import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { App } from '../../src/ui/App';
import '../../src/ui/styles.css';
import { historyRequest, panelRequest, workerRequest } from '../../src/messaging/client';
import { panelChangedSchema } from '../../src/messaging/protocol';
import { preferencesSchema, type PanelState, type Preferences } from '../../src/shared/contracts';
import { marketplaceUrl } from '../../src/platforms/mercadolibre/markets';

function Popup() {
  const [state, setState] = useState<PanelState>({ status: 'loading', snapshot: null, stale: false, message: null });
  const [preferences, setPreferences] = useState<Preferences>();
  const activeTab = useRef<number | undefined>(undefined);
  const tabGeneration = useRef(0);
  const alive = useRef(true);
  const saving = useRef(false);

  useEffect(() => {
    alive.current = true;
    const load = async (generation: number) => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!alive.current || generation !== tabGeneration.current) return;
      activeTab.current = tab?.id;
      if (!tab?.url || !marketplaceUrl(tab.url) || tab.id === undefined) {
        setState({ status: 'unsupported', snapshot: null, stale: false, message: 'Publicacion no compatible.' });
        return;
      }
      const target = tab.id;
      const next = await panelRequest(target, 'panel.get');
      if (alive.current && generation === tabGeneration.current && target === activeTab.current) setState(next);
    };
    const activated = () => {
      const generation = ++tabGeneration.current;
      activeTab.current = undefined;
      setState((previous) => ({ ...previous, status: 'loading', stale: previous.snapshot !== null, message: null }));
      void load(generation).catch(() => {
        if (alive.current && generation === tabGeneration.current) setState({ status: 'error', snapshot: null, stale: false, message: 'Recarga la publicaci\u00f3n para conectar el panel.' });
      });
    };
    const changed: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: unknown, sender) => {
      if (sender.id !== browser.runtime.id || sender.tab?.id !== activeTab.current) return false;
      const parsed = panelChangedSchema.safeParse(message);
      if (parsed.success && alive.current) setState(parsed.data.state);
      return false;
    };
    browser.runtime.onMessage.addListener(changed);
    browser.tabs.onActivated.addListener(activated);
    void workerRequest('preferences.get').then((value) => { if (alive.current) setPreferences(preferencesSchema.parse(value)); }).catch(() => undefined);
    activated();
    return () => { alive.current = false; tabGeneration.current += 1; browser.runtime.onMessage.removeListener(changed); browser.tabs.onActivated.removeListener(activated); };
  }, []);

  async function refresh(): Promise<void> {
    const target = activeTab.current;
    const generation = tabGeneration.current;
    if (target === undefined) return;
    setState((previous) => ({ ...previous, status: 'loading', stale: previous.snapshot !== null, message: null }));
    try {
      const next = await panelRequest(target, 'panel.refresh');
      if (alive.current && generation === tabGeneration.current && target === activeTab.current) setState(next);
    } catch {
      if (alive.current && generation === tabGeneration.current && target === activeTab.current) setState((previous) => ({ ...previous, status: 'error', message: 'No se pudieron actualizar los datos.' }));
    }
  }

  async function open(): Promise<void> {
    const target = activeTab.current;
    const generation = tabGeneration.current;
    if (target === undefined) return;
    try {
      await panelRequest(target, 'panel.open');
      if (alive.current && generation === tabGeneration.current && target === activeTab.current) window.close();
    } catch {
      if (alive.current && generation === tabGeneration.current && target === activeTab.current) setState((previous) => ({ ...previous, status: 'error', message: 'No se pudo abrir el panel.' }));
    }
  }

  async function toggle(enabled: boolean): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    try {
      const next = preferencesSchema.parse(await workerRequest('preferences.set', { panelEnabled: enabled }));
      if (alive.current) setPreferences(next);
    } catch {
      if (alive.current) setState((previous) => ({ ...previous, status: 'error', message: 'No se pudo guardar la preferencia.' }));
    } finally { saving.current = false; }
  }

  return <App state={state} mode="popup" onManage={async key => { await historyRequest('history.manage', { key }, 'done'); }} onRefresh={() => { void refresh(); }} onOpen={() => { void open(); }}
    {...(preferences ? { preferences } : {})} onToggle={(enabled) => { void toggle(enabled); }} />;
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing popup root');
createRoot(container).render(<Popup />);