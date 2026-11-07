import { abrirMotorAndroid } from './motorAndroid';

const motor = abrirMotorAndroid();
// También se serializan los comandos asíncronos: una sola conexión y un solo dueño.
let cola = Promise.resolve();
globalThis.onmessage = ({ data }: MessageEvent<{ id: number; comando: string; datos?: unknown }>) => {
  cola = cola.then(async () => {
    const { id, comando, datos } = data;
    try {
      const app = await motor;
      const resultado = comando === '$cerrar' ? app.cerrar() : await app.invocar(comando, datos);
      globalThis.postMessage({ id, resultado });
    } catch (error) {
      globalThis.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
// La apertura puede fallar antes del primer mensaje; la solicitud recibirá el error.
void motor.catch(() => undefined);
