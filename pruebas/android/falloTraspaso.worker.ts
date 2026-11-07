import { abrirMotorAndroid } from '../../src/plataforma/motorAndroid';
globalThis.onmessage = async ({ data }: MessageEvent<Uint8Array>) => {
  try {
    const motor = await abrirMotorAndroid(async () => { throw new Error('Fallo sintético antes de instalar'); });
    try { await motor.invocar('traspaso:importar', { bytes: data }); }
    catch (error) {
      const balance = await motor.invocar('balance:resumen');
      motor.cerrar();
      globalThis.postMessage({ errorImportacion: String(error), balance });
    }
  } catch (error) { globalThis.postMessage({ error: String(error) }); }
};
