import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// Icono de la aplicación: los recursos existen y las dos configuraciones de
// empaquetado (producción y QA) apuntan a ellos, más el uso en BrowserWindow.
const raiz = path.resolve(__dirname, '..');

function leer(rel: string): string {
  return fs.readFileSync(path.resolve(raiz, rel), 'utf8');
}

function seccion(texto: string, clave: string): string {
  const inicio = texto.indexOf(`${clave}:`);
  if (inicio < 0) return '';
  const resto = texto.slice(inicio + clave.length + 1).split('\n');
  const lineas: string[] = [];
  for (const linea of resto) {
    if (linea.length > 0 && !/^\s/.test(linea)) break;
    lineas.push(linea);
  }
  return lineas.join('\n');
}

describe('icono de la aplicación', () => {
  it('los recursos build/icon.ico y build/icon.png existen y son ficheros reales (ICO/PNG)', () => {
    const ico = fs.readFileSync(path.resolve(raiz, 'build/icon.ico'));
    expect(ico.length, 'build/icon.ico no vacío').toBeGreaterThan(0);
    // Cabecera ICO: 00 00 01 00 (reservado=0, tipo=1 icono).
    expect(Array.from(ico.subarray(0, 4)), 'cabecera ICO').toEqual([0, 0, 1, 0]);

    const png = fs.readFileSync(path.resolve(raiz, 'build/icon.png'));
    expect(png.length, 'build/icon.png no vacío').toBeGreaterThan(0);
    // Firma PNG: 89 50 4E 47 0D 0A 1A 0A.
    expect(png.subarray(0, 8).toString('hex'), 'firma PNG').toBe('89504e470d0a1a0a');
  });

  it('electron-builder.yml: win.icon y los iconos nsis de instalar/desinstalar apuntan a build/icon.ico', () => {
    const cfg = leer('electron-builder.yml');
    const seccionWin = seccion(cfg, 'win');
    expect(seccionWin, 'win.icon: build/icon.ico').toContain('icon: build/icon.ico');
    const seccionNsis = seccion(cfg, 'nsis');
    expect(seccionNsis, 'nsis.installerIcon: build/icon.ico').toContain('installerIcon: build/icon.ico');
    expect(seccionNsis, 'nsis.uninstallerIcon: build/icon.ico').toContain('uninstallerIcon: build/icon.ico');
  });

  it('electron-builder.qa.yml: win.icon y los iconos nsis de instalar/desinstalar apuntan a build/icon.ico', () => {
    const cfg = leer('electron-builder.qa.yml');
    const seccionWin = seccion(cfg, 'win');
    expect(seccionWin, 'win.icon: build/icon.ico').toContain('icon: build/icon.ico');
    const seccionNsis = seccion(cfg, 'nsis');
    expect(seccionNsis, 'nsis.installerIcon: build/icon.ico').toContain('installerIcon: build/icon.ico');
    expect(seccionNsis, 'nsis.uninstallerIcon: build/icon.ico').toContain('uninstallerIcon: build/icon.ico');
  });

  it('src/main/index.ts: BrowserWindow recibe el icono mediante rutaIconoVentana() basada en build/icon.ico', () => {
    const indice = leer('src/main/index.ts');
    expect(indice).toContain('function rutaIconoVentana');
    expect(indice).toContain("path.join(__dirname, '../../build/icon.ico')");
    expect(indice).toContain("path.join(app.getAppPath(), 'build/icon.ico')");
    const creacion = indice.slice(indice.indexOf('new BrowserWindow'));
    expect(creacion, 'BrowserWindow con icon: rutaIconoVentana()').toContain('icon: rutaIconoVentana()');
  });
});
