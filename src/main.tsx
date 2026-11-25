import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function syncCanonicalUrlMeta() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const canonicalUrl = `${window.location.origin}${window.location.pathname}`;
  const canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonicalLink) {
    canonicalLink.href = canonicalUrl;
  }
  const ogUrlMeta = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (ogUrlMeta) {
    ogUrlMeta.content = canonicalUrl;
  }
}

syncCanonicalUrlMeta();

createRoot(document.getElementById('root')!).render(<App />);
