import type Database from 'better-sqlite3';
import { parseMontoMinor, minorATexto } from '../../shared/dinero';
import { registroEvento } from './bitacora';

export class ErrorCatalogo extends Error {}

export interface ItemCatalogo {
  id: number;
  tipo: 'servicio' | 'material';
  codigo: string;
  nombre: string;
  unidad: string | null;
  descripcion: string | null;
  precioVentaMinor: string | null;
  precioCostoMinor: string | null;
  activo: boolean;
}

interface FilaItem {
  id: number;
  tipo: string;
  codigo: string;
  nombre: string;
  unidad: string | null;
  descripcion: string | null;
  precio_venta_minor: number | null;
  precio_costo_minor: number | null;
  activo: number;
}

function mapear(f: FilaItem): ItemCatalogo {
  return {
    id: f.id,
    tipo: f.tipo as 'servicio' | 'material',
    codigo: f.codigo,
    nombre: f.nombre,
    unidad: f.unidad,
    descripcion: f.descripcion,
    precioVentaMinor: f.precio_venta_minor === null ? null : minorATexto(BigInt(f.precio_venta_minor)),
    precioCostoMinor: f.precio_costo_minor === null ? null : minorATexto(BigInt(f.precio_costo_minor)),
    activo: f.activo === 1
  };
}

export function crearItem(
  db: Database.Database,
  entrada: {
    tipo: 'servicio' | 'material';
    codigo: string;
    nombre: string;
    unidad?: string;
    descripcion?: string;
    precioVenta?: string;
    precioCosto?: string;
    responsable: string;
  }
): number {
  if (!['servicio', 'material'].includes(entrada.tipo)) {
    throw new ErrorCatalogo('El tipo debe ser servicio o material');
  }
  if (!/^[A-Z0-9-]{2,12}$/.test(entrada.codigo)) {
    throw new ErrorCatalogo('Código inválido (mayúsculas, números y guiones)');
  }
  if (!entrada.nombre?.trim()) {
    throw new ErrorCatalogo('El ítem requiere nombre');
  }
  const existe = db.prepare('SELECT id FROM item_catalogo WHERE codigo = ?').get(entrada.codigo);
  if (existe) {
    throw new ErrorCatalogo(`Ya existe el ítem ${entrada.codigo}`);
  }
  const precioVenta = entrada.precioVenta ? parseMontoMinor(entrada.precioVenta) : null;
  const precioCosto = entrada.precioCosto ? parseMontoMinor(entrada.precioCosto) : null;
  const info = db
    .prepare(
      `INSERT INTO item_catalogo (tipo, codigo, nombre, unidad, descripcion, precio_venta_minor, precio_costo_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entrada.tipo,
      entrada.codigo,
      entrada.nombre.trim(),
      entrada.unidad?.trim() || null,
      entrada.descripcion?.trim() || null,
      precioVenta,
      precioCosto
    );
  registroEvento(db, entrada.responsable, 'item_creado', 'item_catalogo', String(info.lastInsertRowid), {
    codigo: entrada.codigo,
    nota: 'Precios opcionales; sin valores inventados'
  });
  return Number(info.lastInsertRowid);
}

export function editarItem(
  db: Database.Database,
  itemId: number,
  entrada: {
    nombre?: string;
    unidad?: string | null;
    descripcion?: string | null;
    precioVenta?: string | null;
    precioCosto?: string | null;
    responsable: string;
  }
): void {
  const item = db
    .prepare('SELECT id, codigo, nombre FROM item_catalogo WHERE id = ?')
    .get(itemId) as { id: number; codigo: string; nombre: string } | undefined;
  if (!item) {
    throw new ErrorCatalogo('Ítem inexistente');
  }
  const nombre = entrada.nombre !== undefined ? entrada.nombre.trim() : item.nombre;
  if (!nombre) {
    throw new ErrorCatalogo('El ítem requiere nombre');
  }
  const parsearOpcional = (valor: string | null | undefined): bigint | null | undefined =>
    valor === undefined ? undefined : valor === null || valor === '' ? null : parseMontoMinor(valor);
  const precioVenta = parsearOpcional(entrada.precioVenta);
  const precioCosto = parsearOpcional(entrada.precioCosto);
  const valores: Array<string | bigint | null> = [nombre];
  const sets: string[] = ['nombre = ?'];
  if (entrada.unidad !== undefined) {
    sets.push('unidad = ?');
    valores.push(entrada.unidad?.trim() || null);
  }
  if (entrada.descripcion !== undefined) {
    sets.push('descripcion = ?');
    valores.push(entrada.descripcion?.trim() || null);
  }
  if (precioVenta !== undefined) {
    sets.push('precio_venta_minor = ?');
    valores.push(precioVenta);
  }
  if (precioCosto !== undefined) {
    sets.push('precio_costo_minor = ?');
    valores.push(precioCosto);
  }
  db.prepare(`UPDATE item_catalogo SET ${sets.join(', ')} WHERE id = ?`).run(...valores, itemId);
  registroEvento(db, entrada.responsable, 'item_editado', 'item_catalogo', String(itemId), {
    codigo: item.codigo,
    nota: 'Los documentos históricos conservan sus propias líneas y precios'
  });
}

export function desactivarItem(db: Database.Database, itemId: number, responsable: string): void {
  const item = db
    .prepare('SELECT id, codigo, activo FROM item_catalogo WHERE id = ?')
    .get(itemId) as { id: number; codigo: string; activo: number } | undefined;
  if (!item) {
    throw new ErrorCatalogo('Ítem inexistente');
  }
  if (item.activo === 0) {
    throw new ErrorCatalogo(`El ítem ${item.codigo} ya está inactivo`);
  }
  db.prepare('UPDATE item_catalogo SET activo = 0 WHERE id = ?').run(itemId);
  registroEvento(db, responsable, 'item_desactivado', 'item_catalogo', String(itemId), {
    codigo: item.codigo,
    nota: 'Desactivado, no borrado: los documentos que lo usan conservan su identidad'
  });
}

export function activarItem(db: Database.Database, itemId: number, responsable: string): void {
  const item = db
    .prepare('SELECT id, codigo, activo FROM item_catalogo WHERE id = ?')
    .get(itemId) as { id: number; codigo: string; activo: number } | undefined;
  if (!item) {
    throw new ErrorCatalogo('Ítem inexistente');
  }
  if (item.activo === 1) {
    throw new ErrorCatalogo(`El ítem ${item.codigo} ya está activo`);
  }
  db.prepare('UPDATE item_catalogo SET activo = 1 WHERE id = ?').run(itemId);
  registroEvento(db, responsable, 'item_activado', 'item_catalogo', String(itemId), { codigo: item.codigo });
}

export function listarItems(db: Database.Database, soloActivos = false): ItemCatalogo[] {
  const filas = (
    soloActivos
      ? db.prepare('SELECT * FROM item_catalogo WHERE activo = 1 ORDER BY codigo')
      : db.prepare('SELECT * FROM item_catalogo ORDER BY codigo')
  ).all() as FilaItem[];
  return filas.map(mapear);
}

export function itemPorId(db: Database.Database, itemId: number): ItemCatalogo {
  const fila = db.prepare('SELECT * FROM item_catalogo WHERE id = ?').get(itemId) as FilaItem | undefined;
  if (!fila) {
    throw new ErrorCatalogo('Ítem inexistente');
  }
  return mapear(fila);
}
