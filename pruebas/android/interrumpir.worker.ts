// Solo se empaqueta en la prueba. Nunca se aceptan SQL ni comandos de prueba en producción.
import { abrirMotorAndroid } from '../../src/plataforma/motorAndroid';
void abrirMotorAndroid().then(({ db }) => {
  db.exec('BEGIN');
  db.prepare("INSERT INTO contraparte (nombre, es_cliente, es_proveedor) VALUES (?, 1, 0)").run('AND3 incompleta');
  // Fuerza páginas al diario, no solo cambios en la caché de SQLite.
  db.exec('PRAGMA cache_size = 1');
  for (let i = 0; i < 100; i++) {
    db.prepare("INSERT INTO contraparte (nombre, es_cliente, es_proveedor) VALUES (?, 1, 0)").run(`AND3 incompleta ${i} ${'x'.repeat(1000)}`);
  }
  globalThis.postMessage('a-medias');
  // Queda una transacción abierta. El controlador termina este Worker sin COMMIT/close.
}).catch(error => globalThis.postMessage({ error: error.message }));
