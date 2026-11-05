import type Database from 'better-sqlite3';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';

export function crearCompraParaAdjunto(db: Database.Database, folio: string): void {
  const cuentaCosto = (db.prepare("SELECT id FROM cuenta WHERE codigo = '5101'").get() as { id: number }).id;
  const cuentaProv = (db.prepare("SELECT id FROM cuenta WHERE codigo = '2101'").get() as { id: number }).id;
  const asiento = contabilizarAsiento(db, {
    fechaOperacion: '2026-11-01',
    concepto: `Compra sintética ${folio}`,
    lineas: [
      { cuentaId: cuentaCosto, debeMinor: '1.00', haberMinor: '' },
      { cuentaId: cuentaProv, debeMinor: '', haberMinor: '1.00' }
    ],
    origenTipo: 'compra',
    origenId: folio,
    claveIdempotencia: `compra-adj-${folio}`,
    responsable: 'p',
    ambitoId: 'administrativo'
  });
  const proveedor = db
    .prepare("SELECT id FROM contraparte WHERE es_proveedor = 1 LIMIT 1")
    .get() as { id: number } | undefined;
  const proveedorId = proveedor?.id ?? 1;
  db.prepare(
    "INSERT INTO compra (folio, contraparte_id, fecha_operacion, concepto, condicion, base_minor, iva_minor, total_minor, asiento_id, estado, clave_idempotencia, responsable) VALUES (?, ?, '2026-11-01', ?, 'credito', 100, 0, 100, ?, 'registrada', ?, 'p')"
  ).run(folio, proveedorId, `Compra sintética ${folio}`, asiento.asientoId, `compra-adj-${folio}`);
}
