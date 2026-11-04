import type Database from 'better-sqlite3';

export function saldoPendienteDocumento(db: Database.Database, tipo: 'venta' | 'compra', documentoId: number): bigint {
  const tabla = tipo === 'venta' ? 'venta' : 'compra';
  const doc = db
    .prepare(`SELECT total_minor, estado FROM ${tabla} WHERE id = ?`)
    .get(documentoId) as { total_minor: number; estado: string } | undefined;
  if (!doc) {
    throw new Error(`No existe el documento ${tipo} ${documentoId}`);
  }
  if (doc.estado !== 'registrada') {
    throw new Error(`El documento ${tipo} ${documentoId} no está registrado`);
  }
  const aplicadoDinero = (
    db
      .prepare(
        `SELECT COALESCE(SUM(a.monto_minor), 0) AS total
         FROM aplicacion a JOIN tesoreria_movimiento t ON t.id = a.movimiento_id
         WHERE a.documento_tipo = ? AND a.documento_id = ? AND t.estado = 'registrado'`
      )
      .get(tipo, documentoId) as { total: number }
  ).total;
  const aplicadoAnticipo = (
    db
      .prepare(
        `SELECT COALESCE(SUM(aa.monto_minor), 0) AS total
         FROM aplicacion_anticipo aa
         WHERE aa.documento_tipo = ? AND aa.documento_id = ? AND aa.estado = 'registrada'`
      )
      .get(tipo, documentoId) as { total: number }
  ).total;
  return BigInt(doc.total_minor) - BigInt(aplicadoDinero) - BigInt(aplicadoAnticipo);
}

export function aplicacionesActivasDocumento(db: Database.Database, tipo: 'venta' | 'compra', documentoId: number): number {
  const dinero = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM aplicacion a JOIN tesoreria_movimiento t ON t.id = a.movimiento_id
         WHERE a.documento_tipo = ? AND a.documento_id = ? AND t.estado = 'registrado'`
      )
      .get(tipo, documentoId) as { n: number }
  ).n;
  const anticipo = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM aplicacion_anticipo
         WHERE documento_tipo = ? AND documento_id = ? AND estado = 'registrada'`
      )
      .get(tipo, documentoId) as { n: number }
  ).n;
  return dinero + anticipo;
}
