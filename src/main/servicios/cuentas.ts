import type Database from 'better-sqlite3';
import { registroEvento } from './bitacora';
import type { CuentaResumen } from '../../shared/contratos';

export interface DefinicionCuenta {
  codigo: string;
  nombre: string;
  tipo: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto';
  esGrupo: boolean;
  padre?: string;
  esEfectivo?: boolean;
}

export const catalogoBasePropuesto: DefinicionCuenta[] = [
  { codigo: '1', nombre: 'Activos', tipo: 'activo', esGrupo: true },
  { codigo: '11', nombre: 'Efectivo y equivalentes', tipo: 'activo', esGrupo: true, padre: '1' },
  { codigo: '1101', nombre: 'Caja general', tipo: 'activo', esGrupo: false, padre: '11', esEfectivo: true },
  { codigo: '1102', nombre: 'Caja chica', tipo: 'activo', esGrupo: false, padre: '11', esEfectivo: true },
  { codigo: '1103', nombre: 'Bancos', tipo: 'activo', esGrupo: false, padre: '11', esEfectivo: true },
  { codigo: '12', nombre: 'Cuentas por cobrar', tipo: 'activo', esGrupo: true, padre: '1' },
  { codigo: '1201', nombre: 'Clientes', tipo: 'activo', esGrupo: false, padre: '12' },
  { codigo: '1202', nombre: 'Anticipos a proveedores', tipo: 'activo', esGrupo: false, padre: '12' },
  { codigo: '1203', nombre: 'IVA crédito fiscal', tipo: 'activo', esGrupo: false, padre: '12' },
  { codigo: '13', nombre: 'Inventarios', tipo: 'activo', esGrupo: true, padre: '1' },
  { codigo: '1301', nombre: 'Materiales disponibles', tipo: 'activo', esGrupo: false, padre: '13' },
  { codigo: '14', nombre: 'Proyectos en proceso', tipo: 'activo', esGrupo: true, padre: '1' },
  { codigo: '1401', nombre: 'Costos acumulados de proyectos', tipo: 'activo', esGrupo: false, padre: '14' },
  { codigo: '15', nombre: 'Herramientas y equipos', tipo: 'activo', esGrupo: true, padre: '1' },
  { codigo: '1501', nombre: 'Herramientas y equipos', tipo: 'activo', esGrupo: false, padre: '15' },
  { codigo: '1502', nombre: 'Depreciación acumulada', tipo: 'activo', esGrupo: false, padre: '15' },
  { codigo: '2', nombre: 'Pasivos', tipo: 'pasivo', esGrupo: true },
  { codigo: '21', nombre: 'Cuentas por pagar', tipo: 'pasivo', esGrupo: true, padre: '2' },
  { codigo: '2101', nombre: 'Proveedores', tipo: 'pasivo', esGrupo: false, padre: '21' },
  { codigo: '2102', nombre: 'Anticipos recibidos de clientes', tipo: 'pasivo', esGrupo: false, padre: '21' },
  { codigo: '22', nombre: 'Obligaciones tributarias', tipo: 'pasivo', esGrupo: true, padre: '2' },
  { codigo: '2201', nombre: 'IVA débito fiscal', tipo: 'pasivo', esGrupo: false, padre: '22' },
  { codigo: '2202', nombre: 'Retenciones por enterar', tipo: 'pasivo', esGrupo: false, padre: '22' },
  { codigo: '23', nombre: 'Remuneraciones por pagar', tipo: 'pasivo', esGrupo: true, padre: '2' },
  { codigo: '2301', nombre: 'Remuneraciones por pagar', tipo: 'pasivo', esGrupo: false, padre: '23' },
  { codigo: '3', nombre: 'Patrimonio', tipo: 'patrimonio', esGrupo: true },
  { codigo: '31', nombre: 'Aportes de participantes', tipo: 'patrimonio', esGrupo: true, padre: '3' },
  { codigo: '3101', nombre: 'Cuentas de participantes', tipo: 'patrimonio', esGrupo: false, padre: '31' },
  { codigo: '32', nombre: 'Resultados acumulados', tipo: 'patrimonio', esGrupo: true, padre: '3' },
  { codigo: '3201', nombre: 'Resultados acumulados', tipo: 'patrimonio', esGrupo: false, padre: '32' },
  { codigo: '4', nombre: 'Ingresos', tipo: 'ingreso', esGrupo: true },
  { codigo: '41', nombre: 'Ingresos por servicios', tipo: 'ingreso', esGrupo: true, padre: '4' },
  { codigo: '4101', nombre: 'Ingresos por instalaciones', tipo: 'ingreso', esGrupo: false, padre: '41' },
  { codigo: '4102', nombre: 'Ingresos por operación y mantenimiento', tipo: 'ingreso', esGrupo: false, padre: '41' },
  { codigo: '42', nombre: 'Otros ingresos', tipo: 'ingreso', esGrupo: true, padre: '4' },
  { codigo: '4201', nombre: 'Otros ingresos', tipo: 'ingreso', esGrupo: false, padre: '42' },
  { codigo: '4202', nombre: 'Ganancia en venta de activos fijos', tipo: 'ingreso', esGrupo: false, padre: '42' },
  { codigo: '5', nombre: 'Costos', tipo: 'costo', esGrupo: true },
  { codigo: '51', nombre: 'Costos de proyectos y servicios', tipo: 'costo', esGrupo: true, padre: '5' },
  { codigo: '5101', nombre: 'Costo de materiales', tipo: 'costo', esGrupo: false, padre: '51' },
  { codigo: '5102', nombre: 'Costo de personal de campo', tipo: 'costo', esGrupo: false, padre: '51' },
  { codigo: '5103', nombre: 'Costo de transporte', tipo: 'costo', esGrupo: false, padre: '51' },
  { codigo: '5104', nombre: 'Costo de subcontratación', tipo: 'costo', esGrupo: false, padre: '51' },
  { codigo: '6', nombre: 'Gastos', tipo: 'gasto', esGrupo: true },
  { codigo: '61', nombre: 'Gastos de administración', tipo: 'gasto', esGrupo: true, padre: '6' },
  { codigo: '6101', nombre: 'Gastos de administración', tipo: 'gasto', esGrupo: false, padre: '61' },
  { codigo: '62', nombre: 'Gastos de comercialización', tipo: 'gasto', esGrupo: true, padre: '6' },
  { codigo: '6201', nombre: 'Gastos de comercialización', tipo: 'gasto', esGrupo: false, padre: '62' },
  { codigo: '63', nombre: 'Gastos financieros', tipo: 'gasto', esGrupo: true, padre: '6' },
  { codigo: '6301', nombre: 'Gastos financieros', tipo: 'gasto', esGrupo: false, padre: '63' },
  { codigo: '64', nombre: 'Otros gastos', tipo: 'gasto', esGrupo: true, padre: '6' },
  { codigo: '6402', nombre: 'Pérdida en baja o venta de activos fijos', tipo: 'gasto', esGrupo: false, padre: '64' }
];

export function sembrarCatalogoBase(db: Database.Database, actor = 'sistema'): void {
  const raizExiste = db.prepare("SELECT 1 AS x FROM cuenta WHERE codigo = '1'").get();
  if (raizExiste) {
    return;
  }
  const insertar = db.prepare(
    'INSERT OR IGNORE INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id, es_efectivo) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const porCodigo = new Map<string, number>(
    (db.prepare('SELECT id, codigo FROM cuenta').all() as Array<{ id: number; codigo: string }>).map(c => [c.codigo, c.id])
  );
  const tx = db.transaction(() => {
    for (const def of catalogoBasePropuesto) {
      const padreId = def.padre ? porCodigo.get(def.padre) ?? null : null;
      const info = insertar.run(def.codigo, def.nombre, def.tipo, def.esGrupo ? 1 : 0, padreId, def.esEfectivo ? 1 : 0);
      if (info.changes > 0) {
        porCodigo.set(def.codigo, Number(info.lastInsertRowid));
      }
    }
  });
  tx();
  registroEvento(db, actor, 'siembra_catalogo', 'cuenta', null, {
    total: catalogoBasePropuesto.length,
    nota: 'Catálogo base propuesto, editable y pendiente de revisión del contador responsable'
  });
}


export type CuentaFila = CuentaResumen;

export function listarCuentas(db: Database.Database): CuentaFila[] {
  const filas = db
    .prepare('SELECT id, codigo, nombre, tipo, es_grupo, padre_id, activa FROM cuenta ORDER BY codigo')
    .all() as Array<{
    id: number;
    codigo: string;
    nombre: string;
    tipo: string;
    es_grupo: number;
    padre_id: number | null;
    activa: number;
  }>;
  return filas.map(f => ({
    id: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    tipo: f.tipo,
    esGrupo: f.es_grupo === 1,
    padreId: f.padre_id,
    activa: f.activa === 1
  }));
}

export function crearCuenta(
  db: Database.Database,
  entrada: { codigo: string; nombre: string; tipo: string; esGrupo: boolean; padreId?: number; responsable: string }
): number {
  if (!/^\d{2,8}$/.test(entrada.codigo)) {
    throw new Error('Código de cuenta inválido: 2 a 8 dígitos');
  }
  if (!entrada.nombre.trim()) {
    throw new Error('La cuenta requiere nombre');
  }
  const tipos = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'];
  if (!tipos.includes(entrada.tipo)) {
    throw new Error('Tipo de cuenta inválido');
  }
  const existe = db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(entrada.codigo);
  if (existe) {
    throw new Error(`Ya existe la cuenta ${entrada.codigo}`);
  }
  const info = db
    .prepare('INSERT INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id) VALUES (?, ?, ?, ?, ?)')
    .run(entrada.codigo, entrada.nombre.trim(), entrada.tipo, entrada.esGrupo ? 1 : 0, entrada.padreId ?? null);
  registroEvento(db, entrada.responsable, 'creacion_cuenta', 'cuenta', String(info.lastInsertRowid), entrada);
  return Number(info.lastInsertRowid);
}
