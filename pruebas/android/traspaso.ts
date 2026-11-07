import { crearPuenteAndroid } from '../../src/plataforma/puenteAndroid';

const esperar = () => new Promise(resolve => setTimeout(resolve,250));
function abrir() {
  const worker = new Worker(new URL('../../src/plataforma/android.worker.ts', import.meta.url), { type: 'module' });
  return { worker, api: crearPuenteAndroid(worker) };
}
async function fixture(worker: Worker, datos: unknown): Promise<any> {
  try {
    return await new Promise((resolve,reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = () => reject(new Error('Falló fixture AND4'));
      worker.postMessage(datos);
    });
  } finally { worker.terminate(); }
}
export async function probarTraspaso() {
  const bytes = new Uint8Array(await (await fetch('/and4.arkon')).arrayBuffer());
  const futuro = new Uint8Array(await (await fetch('/futuro.arkon')).arrayBuffer());
  let motor = abrir();
  const original = await motor.api.invocar('traspaso:exportar') as { bytes: Uint8Array };
  const importar = async (datos: Uint8Array) => motor.api.invocar('traspaso:importar', { bytes: datos });
  const errores: string[] = [];
  const balance = () => motor.api.invocar('balance:resumen');
  let fase = 'importar';
  try {
    await importar(bytes);
    fase = 'reinicio tras importar';
    motor.worker.terminate(); await esperar(); motor = abrir();
    const persistido = await balance();
    const alterado = bytes.slice(); alterado[alterado.length-1] ^= 1;
    try { await importar(alterado); } catch (error) { errores.push((error as Error).message); }
    const trasAlterado = await balance();
    try { await importar(futuro); } catch (error) { errores.push((error as Error).message); }
    const trasFuturo = await balance();
    const retorno = await motor.api.invocar('traspaso:exportar') as { bytes: Uint8Array; nombre: string };
    await fetch('/retorno.arkon', { method: 'POST', body: retorno.bytes.slice().buffer });
    // El fixture detiene la importación real justo después de cerrar la activa.
    fase = 'corte';
    await motor.api.invocar('$cerrar'); motor.worker.terminate();
    const interrumpido = new Worker(new URL('./traspasoInterrumpido.worker.ts', import.meta.url), { type: 'module' });
    await new Promise<void>((resolve,reject) => {
      interrumpido.onmessage = ({ data }) => data === 'cerrada' ? resolve() : reject(new Error(data.error));
      interrumpido.onerror = () => reject(new Error('Error en corte de traspaso'));
      // Otro saldo: si se activa el paquete antes del corte se detecta.
      interrumpido.postMessage(original.bytes);
    });
    fase = 'recuperación';
    interrumpido.terminate(); await esperar(); motor = abrir();
    try { await balance(); } catch (error) { errores.push((error as Error).message); }
    motor.worker.terminate(); await esperar(); motor = abrir();
    const trasCorte = await balance();
    const trasCortePaquete = await motor.api.invocar('traspaso:exportar') as { bytes: Uint8Array };
    await fetch('/recuperado.arkon', { method: 'POST', body: trasCortePaquete.bytes.slice().buffer });
    fase = 'fallo de instalación';
    await motor.api.invocar('$cerrar'); motor.worker.terminate();
    const fallo = await fixture(new Worker(new URL('./falloTraspaso.worker.ts', import.meta.url), { type: 'module' }),original.bytes);
    motor = abrir();
    const trasFallo = await balance();
    fase = 'premigración';
    await motor.api.invocar('$cerrar'); motor.worker.terminate();
    const previo = await fixture(new Worker(new URL('./migracion.worker.ts', import.meta.url), { type: 'module' }),{});
    motor = abrir();
    let errorMigracion = '';
    try { await balance(); } catch (error) { errorMigracion = String(error); }
    motor.worker.terminate();
    const migracion = await fixture(new Worker(new URL('./migracion.worker.ts', import.meta.url), { type: 'module' }),{ verificar: true, migracion: previo.migracion });
    motor = abrir();
    const trasMigracion = await balance();
    await importar(original.bytes);
    return { persistido, trasAlterado, trasFuturo, trasCorte, trasFallo, fallo, trasMigracion, errorMigracion, migracion, huellaPrevia: previo.huella, errores, nombre: retorno.nombre };
  } catch (error) { throw new Error(`AND4 ${fase}: ${String(error)}`); }
  finally {
    try { await motor.api.invocar('$cerrar'); } catch { /* conservar error original */ }
    motor.worker.terminate();
  }
}
