import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migraciones } from '../src/main/db/migraciones';
import { aplicarMigraciones } from '../src/main/db/aplicarMigraciones';
import { sembrarCatalogoBase } from '../src/main/servicios/cuentas';
import { contabilizarAsiento } from '../src/main/servicios/motorAsientos';
import { estadoSituacionFinanciera } from '../src/main/servicios/estadosFinancieros';

describe('6F: clasificación del balance', () => {
  it.each([false, true])('clasifica IVA sin padre y conserva importes (migrada v19: %s)', migrada => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      if (migrada) {
        db.exec(`CREATE TABLE _migracion (version INTEGER PRIMARY KEY, nombre TEXT NOT NULL)`);
        for (const m of migraciones.filter(m => m.version <= 19)) {
          db.exec(m.sql);
          db.prepare('INSERT INTO _migracion (version, nombre) VALUES (?, ?)').run(m.version, m.nombre);
        }
      } else {
        aplicarMigraciones(db);
      }
      sembrarCatalogoBase(db);
      db.prepare("INSERT INTO ambito (id, nombre, tipo) VALUES ('administrativo', 'QA', 'administrativo')").run();
      db.prepare("UPDATE cuenta SET padre_id = NULL WHERE codigo = '1203'").run();
      db.exec(`INSERT INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id) VALUES
        ('1199', 'QA bajo no corriente', 'activo', 0, (SELECT id FROM cuenta WHERE codigo = '15')),
        ('1999', 'QA desconocida', 'activo', 0, NULL),
        ('1998', 'QA ancestro intermedio', 'activo', 1, (SELECT id FROM cuenta WHERE codigo = '12'));
        INSERT INTO cuenta (codigo, nombre, tipo, es_grupo, padre_id) VALUES
        ('199801', 'QA descendiente', 'activo', 0, (SELECT id FROM cuenta WHERE codigo = '1998'))`);
      const id = (codigo: string) => (db.prepare('SELECT id FROM cuenta WHERE codigo = ?').get(codigo) as { id: number }).id;
      // A mano: IVA 13 + herramienta 80 + desconocida 7 + descendiente 20 = 120 de capital.
      contabilizarAsiento(db, {
        fechaOperacion: '2026-01-15', concepto: 'QA clasificación', responsable: 'qa', ambitoId: 'administrativo',
        claveIdempotencia: 'qa-6f',
        lineas: [
          ...[['1203', '13.00'], ['1199', '80.00'], ['1999', '7.00'], ['199801', '20.00']].map(([codigo, debeMinor]) => ({
            cuentaId: id(codigo!), debeMinor: debeMinor!, haberMinor: ''
          })),
          { cuentaId: id('3101'), debeMinor: '', haberMinor: '120.00' }
        ]
      });
      const comprobar = () => {
        const e = estadoSituacionFinanciera(db, { corte: '2026-01-31' });
        expect(e.activo.corriente.find(f => f.codigo === '1203')).toMatchObject({ saldoMinor: '13.00', sinClasificar: false });
        expect(e.activo.corriente.find(f => f.codigo === '199801')?.saldoMinor).toBe('20.00');
        expect(e.activo.noCorriente.find(f => f.codigo === '1199')?.saldoMinor).toBe('80.00');
        expect(e.activo.sinClasificar.map(f => [f.codigo, f.saldoMinor])).toEqual([['1999', '7.00']]);
        expect(e.activo.totalMinor).toBe('120.00');
        expect(e.pasivo.totalMinor).toBe('0.00');
        expect(e.patrimonio.totalMinor).toBe('120.00');
        expect(e.cuadra).toBe(true);
      };
      comprobar();
      if (migrada) {
        aplicarMigraciones(db);
        expect(db.prepare("SELECT padre_id FROM cuenta WHERE codigo = '1203'").get()).toEqual({ padre_id: id('12') });
        // La reparación no debe sustituir padres existentes elegidos por el catálogo.
        expect(db.prepare("SELECT padre_id FROM cuenta WHERE codigo = '1199'").get()).toEqual({ padre_id: id('15') });
        comprobar();
      }
    } finally {
      db.close();
    }
  });
});
