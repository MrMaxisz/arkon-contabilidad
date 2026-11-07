import { aBase64 } from './archivosAndroid';

// URL procesada por Vite: también funciona con nombres hash en el APK empaquetado.
const recursos = [
  [new URL('../renderer/recursos/fuentes/barlow-condensed-latin-700-normal.woff2', import.meta.url), 'Barlow Condensed', '700'],
  [new URL('../renderer/recursos/fuentes/ibm-plex-sans-latin-400-normal.woff2', import.meta.url), 'IBM Plex Sans', '400'],
  [new URL('../renderer/recursos/fuentes/ibm-plex-sans-latin-600-normal.woff2', import.meta.url), 'IBM Plex Sans', '600'],
  [new URL('../renderer/recursos/fuentes/ibm-plex-mono-latin-400-normal.woff2', import.meta.url), 'IBM Plex Mono', '400']
] as const;
async function cargar(url: URL) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('No se pudo cargar un recurso local del PDF');
  return r;
}
export async function recursosPdfAndroid() {
  const logoSvg = await (await cargar(new URL('../renderer/recursos/arkon-logo-azul.svg', import.meta.url))).text();
  const fuentesCss = (await Promise.all(recursos.map(async ([url, familia, peso]) => {
    const base64 = aBase64(new Uint8Array(await (await cargar(url)).arrayBuffer()));
    return `@font-face { font-family: '${familia}'; font-style: normal; font-weight: ${peso}; src: url(data:font/woff2;base64,${base64}) format('woff2'); }`;
  }))).join('\n');
  return { logoSvg, fuentesCss };
}
