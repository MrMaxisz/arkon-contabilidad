import { crearPuenteAndroid } from '../plataforma/puenteAndroid';
import type { ArkonApi } from './api';
import './movil.css';

async function iniciar() {
  document.documentElement.dataset.plataforma = 'android';
  const puente = crearPuenteAndroid(new Worker(new URL('../plataforma/android.worker.ts', import.meta.url), { type: 'module' }));
  (window as unknown as { arkon: ArkonApi }).arkon = puente;
  // Inicializa antes de montar React y muestra los fallos de almacenamiento al usuario.
  await puente.invocar('balance:resumen');
  await import('./index');
}
void iniciar().catch(error => {
  const raiz = document.getElementById('raiz');
  if (raiz) { raiz.setAttribute('role', 'alert'); raiz.textContent = `No se pudo abrir la base persistente: ${error.message}`; }
});
