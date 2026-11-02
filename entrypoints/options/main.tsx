import { createRoot } from 'react-dom/client';
import { HistoryOptions } from '../../src/features/history/HistoryOptions';
import '../../src/ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing options root');
createRoot(container).render(<HistoryOptions />);