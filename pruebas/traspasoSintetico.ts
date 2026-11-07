import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { registrarAdjunto } from '../src/main/servicios/adjuntos';
import { balanceResumen } from '../src/main/servicios/estadosFinancieros';
import type { ContextoApp } from '../src/main/servicios/restauracion';

export function sembrarTraspaso(ctx: ContextoApp) {
  const { db } = ctx, p = ctx.plataforma!;
  sembrarCatalogoBase(db, 'prueba');
  db.prepare("INSERT OR IGNORE INTO ambito (id,nombre,tipo) VALUES ('administrativo','Sintético AND4','administrativo')").run();
  const id = (codigo: string) => (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
  for (const importe of ['123.45','76.55']) contabilizarAsiento(db, {
    fechaOperacion: '2026-02-01', concepto: 'Aporte sintético AND4', responsable: 'prueba', ambitoId: 'administrativo',
    lineas: [{ cuentaId: id('1101'), debeMinor: importe, haberMinor: '' }, { cuentaId: id('3101'), debeMinor: '', haberMinor: importe }]
  });
  db.exec('CREATE TABLE entero_sintetico (importe INTEGER)');
  db.prepare('INSERT INTO entero_sintetico VALUES (?)').run(9007199254740993n);
  const origen = p.rutas.join(ctx.rutas.raiz, 'sintetico.txt');
  p.archivos.writeFileSync(origen, 'Documento sintético AND4\nSin datos reales.\0');
  registrarAdjunto(db, ctx.rutas.adjuntos, { entidad: 'proyecto', entidadId: 'AND4-sintetico', nombreOriginal: 'sintetico.txt', rutaOrigen: origen, responsable: 'prueba' }, p);
}

export function estadoTraspaso(ctx: ContextoApp) {
  const db = ctx.db, p = ctx.plataforma!;
  return {
    balance: balanceResumen(db),
    partidas: db.prepare('SELECT * FROM asiento_linea ORDER BY id').safeIntegers().all(),
    numeracion: db.prepare('SELECT id,folio FROM asiento ORDER BY id').safeIntegers().all(),
    enteros: db.prepare('SELECT * FROM entero_sintetico').safeIntegers().all(),
    inventario: p.inventarioAdjuntosRegistrado(db),
    adjuntos: p.inventarioAdjuntosRegistrado(db).map(a => [...p.archivos.readFileSync(p.rutas.join(ctx.rutas.adjuntos, a.rutaRelativa))])
  };
}
