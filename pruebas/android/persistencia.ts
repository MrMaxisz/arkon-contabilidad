import { crearPuenteAndroid } from '../../src/plataforma/puenteAndroid';
import { probarTraspaso } from './traspaso';

const esperar = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function abrir() {
  const worker = new Worker(new URL('../../src/plataforma/android.worker.ts', import.meta.url), { type: 'module' });
  return { worker, api: crearPuenteAndroid(worker) };
}
(window as unknown as { pruebaTerminada: Promise<unknown> }).pruebaTerminada = (async () => {
  let motor = abrir();
  const cuentas = await motor.api.invocar('cuenta:listar') as Array<{ id: number; codigo: string }>;
  const id = (codigo: string) => cuentas.find(c => c.codigo === codigo)!.id;
  await motor.api.invocar('asiento:contabilizar', {
    fechaOperacion: '2026-01-10', concepto: 'Aporte sintético AND3', responsable: 'prueba',
    ambitoId: 'administrativo', claveIdempotencia: 'AND3-aporte',
    lineas: [{ cuentaId: id('1101'), debeMinor: '123.45', haberMinor: '' },
      { cuentaId: id('3101'), debeMinor: '', haberMinor: '123.45' }]
  });
  motor.worker.terminate();
  await esperar(250);
  motor = abrir();
  const persistido = await motor.api.invocar('balance:resumen');
  const rechazos: string[] = [];
  for (const [comando, datos] of [['libro:partidas', { ambitoId: 'juridico' }], ['respaldo:crear', {}], ['toString', {}]] as const) {
    try { await motor.api.invocar(comando, datos); } catch (error) { rechazos.push((error as Error).message); }
  }
  try { await motor.api.pdfCotizacion(1); } catch (error) { rechazos.push((error as Error).message); }
  await motor.api.invocar('$cerrar');
  motor.worker.terminate();
  const interrumpido = new Worker(new URL('./interrumpir.worker.ts', import.meta.url), { type: 'module' });
  await new Promise<void>((resolve, reject) => {
    interrumpido.onmessage = ({ data }) => data === 'a-medias' ? resolve() : reject(new Error(data.error));
    interrumpido.onerror = () => reject(new Error('Falló Worker de interrupción'));
  });
  interrumpido.terminate();
  await esperar(250);
  motor = abrir();
  const contrapartes = await motor.api.invocar('contraparte:listar');
  const trasCorte = await motor.api.invocar('balance:resumen');
  await motor.api.invocar('$cerrar');
  motor.worker.terminate();
  const traspaso = await probarTraspaso();
  return { persistido, trasCorte, contrapartes, rechazos, traspaso, aislado: crossOriginIsolated };
})();
