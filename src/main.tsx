import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installTransportDiagnostics } from './utils/transportSecurity';

if (import.meta.env.PROD) installTransportDiagnostics(document);

// After a new deploy, an open tab can ask for a page chunk the server no longer has.
// Reload once to pick up the new build instead of showing a broken page.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('trafficpulse.chunkReload')) return;
    sessionStorage.setItem('trafficpulse.chunkReload', '1');
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});
// Once the page has loaded fine, allow the same recovery again after a later deploy.
window.addEventListener('load', () =>
  setTimeout(() => {
    try {
      sessionStorage.removeItem('trafficpulse.chunkReload');
    } catch {
      // Storage blocked: the guard above already stops reload loops
    }
  }, 10000),
);

createRoot(document.getElementById('root')!).render(<App />);

// Offline support and home-screen install (production builds only, so dev always loads fresh code).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app works the same without it, just not offline
    });
  });
}
