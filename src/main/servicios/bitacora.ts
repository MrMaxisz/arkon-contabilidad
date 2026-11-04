import type Database from 'better-sqlite3';

export function registroEvento(
  db: Database.Database,
  actor: string,
  tipo: string,
  entidad: string,
  entidadId: string | null,
  detalle: unknown
): void {
  db.prepare(
    'INSERT INTO bitacora_evento (actor, tipo, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?)'
  ).run(actor, tipo, entidad, entidadId, detalle === undefined ? null : JSON.stringify(detalle));
}

export interface EventoBitacora {
  id: number;
  fecha: string;
  actor: string;
  tipo: string;
  entidad: string;
  entidadId: string | null;
  detalle: string | null;
}

export function listarEventos(db: Database.Database, limite = 100): EventoBitacora[] {
  return db
    .prepare('SELECT * FROM bitacora_evento ORDER BY id DESC LIMIT ?')
    .all(limite) as EventoBitacora[];
}
