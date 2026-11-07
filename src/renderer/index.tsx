import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import App from './App';
import './estilos.css';

createRoot(document.getElementById('raiz') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
