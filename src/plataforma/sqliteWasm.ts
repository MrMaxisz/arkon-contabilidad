export type SqliteWasmValue = string | number | bigint | Uint8Array | Int8Array | ArrayBuffer | null | undefined;

export interface SqliteWasmRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteWasmStatement {
  run(...parametros: SqliteWasmValue[]): SqliteWasmRunResult;
  get<T extends Record<string, unknown> = Record<string, unknown>>(...parametros: SqliteWasmValue[]): T | undefined;
  all<T extends Record<string, unknown> = Record<string, unknown>>(...parametros: SqliteWasmValue[]): T[];
  safeIntegers(activar?: boolean): this;
}

export interface SqliteWasmDatabase {
  readonly open: boolean;
  readonly lastInsertRowid: number | bigint;
  readonly changes: number;
  prepare(sql: string): SqliteWasmStatement;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
}

interface WasmStatement {
  bind(parametros: readonly SqliteWasmValue[] | Record<string, SqliteWasmValue>): WasmStatement;
  step(): boolean;
  get(destino: Record<string, SqliteWasmValue>): Record<string, SqliteWasmValue>;
  reset(limpiar?: boolean): WasmStatement;
}

interface WasmDatabase {
  prepare(sql: string): WasmStatement;
  exec(sql: string, opciones?: { rowMode?: 'object'; returnValue?: 'resultRows' }): Record<string, SqliteWasmValue>[];
  changes(total?: boolean, sesentaYCuatro?: boolean): number | bigint;
  close(): void;
  isOpen(): boolean;
}

function parametrosDe(parametros: SqliteWasmValue[]): readonly SqliteWasmValue[] | Record<string, SqliteWasmValue> {
  const primero = parametros[0];
  if (parametros.length === 1 && Array.isArray(primero)) {
    return primero as unknown as readonly SqliteWasmValue[];
  }
  if (parametros.length === 1 && primero !== null && typeof primero === 'object' && !ArrayBuffer.isView(primero) && !(primero instanceof ArrayBuffer)) {
    return primero as unknown as Record<string, SqliteWasmValue>;
  }
  return parametros;
}

function normalizarFila(fila: Record<string, SqliteWasmValue>, safeIntegers: boolean): Record<string, unknown> {
  if (!safeIntegers) {
    return fila;
  }
  return Object.fromEntries(
    Object.entries(fila).map(([clave, valor]) => [
      clave,
      typeof valor === 'number' && Number.isInteger(valor) ? BigInt(valor) : valor
    ])
  );
}

function enteroSqlite(valor: SqliteWasmValue | unknown): number | bigint {
  if (typeof valor === 'number' || typeof valor === 'bigint') {
    return valor;
  }
  throw new Error('SQLite devolvió un last_insert_rowid no entero');
}

class StatementAdapter implements SqliteWasmStatement {
  private safe = false;

  public constructor(private readonly statement: WasmStatement, private readonly db: WasmDatabase) {}

  public safeIntegers(activar = true): this {
    this.safe = activar;
    return this;
  }

  public run(...parametros: SqliteWasmValue[]): SqliteWasmRunResult {
    if (parametros.length > 0) {
      this.statement.bind(parametrosDe(parametros));
    }
    try {
      this.statement.step();
      return {
        changes: Number(this.db.changes(false, false)),
        lastInsertRowid: this.lastInsertRowid()
      };
    } finally {
      this.statement.reset(true);
    }
  }

  public get<T extends Record<string, unknown>>(...parametros: SqliteWasmValue[]): T | undefined {
    if (parametros.length > 0) {
      this.statement.bind(parametrosDe(parametros));
    }
    try {
      if (!this.statement.step()) {
        return undefined;
      }
      return normalizarFila(this.statement.get({}), this.safe) as T;
    } finally {
      this.statement.reset(true);
    }
  }

  public all<T extends Record<string, unknown>>(...parametros: SqliteWasmValue[]): T[] {
    if (parametros.length > 0) {
      this.statement.bind(parametrosDe(parametros));
    }
    const filas: T[] = [];
    try {
      while (this.statement.step()) {
        filas.push(normalizarFila(this.statement.get({}), this.safe) as T);
      }
      return filas;
    } finally {
      this.statement.reset(true);
    }
  }

  private lastInsertRowid(): number | bigint {
    const fila = this.db.exec('SELECT last_insert_rowid() AS id', { rowMode: 'object', returnValue: 'resultRows' })[0];
    return enteroSqlite(fila?.id ?? 0);
  }
}

export class SqliteWasmDatabaseAdapter implements SqliteWasmDatabase {
  private profundidad = 0;
  private savepoint = 0;
  private abierto = true;

  public constructor(private readonly db: WasmDatabase) {}

  public get open(): boolean {
    return this.abierto && this.db.isOpen();
  }

  public get lastInsertRowid(): number | bigint {
    const fila = this.db.exec('SELECT last_insert_rowid() AS id', { rowMode: 'object', returnValue: 'resultRows' })[0];
    return enteroSqlite(fila?.id ?? 0);
  }

  public get changes(): number {
    return Number(this.db.changes(false, false));
  }

  public prepare(sql: string): SqliteWasmStatement {
    return new StatementAdapter(this.db.prepare(sql), this.db);
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public pragma(sql: string): unknown {
    if (/[=;]/.test(sql)) {
      this.db.exec(`PRAGMA ${sql}`);
      return undefined;
    }
    return this.db.exec(`PRAGMA ${sql}`, { rowMode: 'object', returnValue: 'resultRows' });
  }

  public transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args: unknown[]): T => {
      const nivel = this.profundidad++;
      const nombre = `arkon_tx_${this.savepoint++}`;
      try {
        this.db.exec(nivel === 0 ? 'BEGIN' : `SAVEPOINT ${nombre}`);
        const resultado = fn(...args);
        this.db.exec(nivel === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${nombre}`);
        return resultado;
      } catch (error) {
        this.db.exec(nivel === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${nombre}; RELEASE SAVEPOINT ${nombre}`);
        throw error;
      } finally {
        this.profundidad--;
      }
    };
  }

  public close(): void {
    if (this.abierto) {
      this.db.close();
      this.abierto = false;
    }
  }
}
