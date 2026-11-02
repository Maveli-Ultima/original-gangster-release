import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useGame } from './app/store';
import { installUiScale } from './app/uiScale';
import './styles.css';

// The desktop app's interface scale, before the first frame is drawn.
installUiScale(() => useGame.getState().uiScale);

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
