import { useEffect } from 'react';
import { useGame } from '../app/store';

/** Save failures remain visible, including when settlement opens the ending. */
export function Toast() {
  const toast = useGame(s => s.toast);
  const clearToast = useGame(s => s.clearToast);
  useEffect(() => {
    if (!toast || toast.bad) return;
    const timer = setTimeout(clearToast, 3600);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);
  if (!toast) return null;
  return <div className={`paper toast${toast.bad ? ' bad' : ''}`} role={toast.bad ? 'alert' : 'status'}>
    {toast.text}
    {toast.bad && <button className="btn sm" onClick={clearToast} aria-label="Dismiss message">×</button>}
  </div>;
}
