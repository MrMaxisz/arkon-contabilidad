import { abrirMotorAndroid } from '../../src/plataforma/motorAndroid';
// Inyección solo en fixture. Producción no conoce comandos ni puntos de fallo.
globalThis.onmessage = async ({ data }: MessageEvent<Uint8Array>) => {
  try {
    const motor = await abrirMotorAndroid(async () => {
      globalThis.postMessage('cerrada');
      // El controlador termina el Worker antes de importDb.
      await new Promise<void>(() => undefined);
    });
    await motor.invocar('traspaso:importar', { bytes: data });
  } catch (error) { globalThis.postMessage({ error: String(error) }); }
};
