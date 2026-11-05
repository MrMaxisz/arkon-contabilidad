import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { validarFechaCalendario } from '../../shared/fechas';
import { minorATexto } from '../../shared/dinero';

export class ErrorAnexo extends Error {}

export interface ResultadoAnexo1 {
  csv: string;
  version: string;
  mes: string;
  filas: number;
  incompletos: Array<{ folio: string; faltantes: string[] }>;
  advertencia: string;
  fuente: string;
}

const FUENTE_OFICIAL =
  'Manual de usuario para carga de archivo de los anexos de la declaración F-07 v14 (DGII, Ministerio de Hacienda El Salvador, Enero 2025), Anexo 1: Detalle de Ventas a Contribuyentes, columnas A-T';

function dosDecimales(minor: bigint): string {
  return minorATexto(minor);
}

function fechaDdMmAaaa(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function exportarAnexo1VentasContribuyentes(db: Database, mes: string): ResultadoAnexo1 {
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    throw new ErrorAnexo(`Mes inválido (AAAA-MM): ${mes}`);
  }
  validarFechaCalendario(`${mes}-01`);
  const inicio = `${mes}-01`;
  const fin = `${mes}-31`;

  const ventas = db
    .prepare(
      `SELECT v.id, v.folio, v.fecha_operacion AS fecha, v.tipo_ingreso, v.base_minor, v.iva_minor, v.total_minor,
              COALESCE(c.nit, '') AS nit, COALESCE(c.nrc, '') AS nrc, c.nombre,
              COALESCE(v.tipo_documento, '') AS tipo_documento
       FROM venta v
       JOIN contraparte c ON c.id = v.contraparte_id
       WHERE v.estado = 'registrada'
         AND v.clasificacion_documento = 'contribuyente'
         AND v.fecha_operacion >= ? AND v.fecha_operacion <= ?
       ORDER BY v.fecha_operacion, v.id`
    )
    .all(inicio, fin) as Array<{
    id: number;
    folio: string;
    fecha: string;
    tipo_ingreso: string;
    base_minor: number;
    iva_minor: number;
    total_minor: number;
    nit: string;
    nrc: string;
    nombre: string;
    tipo_documento: string;
  }>;

  const lineas: string[] = [];
  const incompletos: Array<{ folio: string; faltantes: string[] }> = [];

  for (const v of ventas) {
    const gravadas = v.iva_minor > 0 ? v.base_minor : 0;
    const exentas = v.iva_minor > 0 ? 0 : v.base_minor;
    const noSujetas = 0;

    const faltantes: string[] = [];
    if (v.iva_minor === 0) {
      faltantes.push('tratamiento de la base sin IVA (exenta vs no sujeta) sin desglose en la venta');
    }
    const identificacion = (v.nit || '').replace(/[-|]/g, '') || (v.nrc || '').replace(/[-|]/g, '');
    if (!identificacion) {
      faltantes.push('NIT o NRC del cliente');
    }
    const tipoDocumento = v.tipo_documento === 'ccf' ? '03' : v.tipo_documento === 'otro' ? '' : '';
    if (!tipoDocumento) {
      faltantes.push('tipo de documento autorizado (CCF)');
    }
    if (faltantes.length > 0) {
      incompletos.push({ folio: v.folio, faltantes });
    }

    const total = dosDecimales(BigInt(v.total_minor));

    const aplicaRenta = mes >= '2025-01';
    const tipoOperacion = aplicaRenta ? (v.iva_minor > 0 ? '1' : '2') : '0';
    const tipoIngreso = aplicaRenta ? '2' : '0';

    lineas.push(
      [
        fechaDdMmAaaa(v.fecha),
        '',
        tipoDocumento,
        '',
        '',
        '',
        v.folio,
        identificacion,
        v.nombre,
        dosDecimales(BigInt(exentas)),
        dosDecimales(BigInt(noSujetas)),
        dosDecimales(BigInt(gravadas)),
        dosDecimales(BigInt(v.iva_minor)),
        '0.00',
        '0.00',
        total,
        '',
        tipoOperacion,
        tipoIngreso,
        '1'
      ].join(';')
    );
  }

  return {
    csv: lineas.join('\n'),
    version: 'anexo-f07-v14-anexo1-esquema1',
    mes,
    filas: lineas.length,
    incompletos,
    advertencia:
      'Estructura oficial F-07 v14 Anexo 1. ARKON no está constituida ni inscrita en IVA: este archivo NO debe presentarse a Hacienda sin la activación formal del contador. Las columnas de clase de documento, resolución, serie y número autorizado quedan vacías porque ARKON no tiene autorización de documentos; los folios con datos faltantes se listan en incompletos.',
    fuente: FUENTE_OFICIAL
  };
}
