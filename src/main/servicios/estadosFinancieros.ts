import type Database from 'better-sqlite3';
import { minorATexto } from '../../shared/dinero';

export interface SaldoCuenta {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: string;
  saldoMinor: string;
}

interface SaldoCrudo {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  saldo: number | null;
}

function saldosCrudos(db: Database.Database): SaldoCrudo[] {
  return db
    .prepare(
      `SELECT c.id, c.codigo, c.nombre, c.tipo,
              COALESCE(SUM(l.debe_minor - l.haber_minor), 0) AS saldo
       FROM cuenta c
       LEFT JOIN asiento_linea l ON l.cuenta_id = c.id
       LEFT JOIN asiento a ON a.id = l.asiento_id AND a.estado IN ('contabilizado','anulado')
       WHERE c.es_grupo = 0
       GROUP BY c.id
       ORDER BY c.codigo`
    )
    .all() as SaldoCrudo[];
}

export function saldosPorCuenta(db: Database.Database): SaldoCuenta[] {
  return saldosCrudos(db).map(f => ({
    cuentaId: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    tipo: f.tipo,
    saldoMinor: minorATexto(BigInt(f.saldo ?? 0))
  }));
}

export interface BalanceResumen {
  totalActivoMinor: string;
  totalPasivoMinor: string;
  totalPatrimonioMinor: string;
  totalResultadoMinor: string;
  cuadra: boolean;
}

export function balanceResumen(db: Database.Database): BalanceResumen {
  let activo = 0n;
  let pasivo = 0n;
  let patrimonio = 0n;
  let resultado = 0n;
  for (const f of saldosCrudos(db)) {
    const saldo = BigInt(f.saldo ?? 0);
    switch (f.tipo) {
      case 'activo':
        activo += saldo;
        break;
      case 'pasivo':
        pasivo += -saldo;
        break;
      case 'patrimonio':
        patrimonio += -saldo;
        break;
      case 'ingreso':
        resultado += -saldo;
        break;
      case 'costo':
      case 'gasto':
        resultado += -saldo;
        break;
      default:
        break;
    }
  }
  return {
    totalActivoMinor: minorATexto(activo),
    totalPasivoMinor: minorATexto(pasivo),
    totalPatrimonioMinor: minorATexto(patrimonio),
    totalResultadoMinor: minorATexto(resultado),
    cuadra: activo === pasivo + patrimonio + resultado
  };
}
