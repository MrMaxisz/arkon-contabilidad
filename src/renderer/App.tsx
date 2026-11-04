import React, { useEffect, useState } from 'react';
import { api } from './api';
import Contabilidad from './vistas/Contabilidad';
import Respaldo from './vistas/Respaldo';
import Bitacora from './vistas/Bitacora';
import Contrapartes from './vistas/Contrapartes';
import Cotizaciones from './vistas/Cotizaciones';
import Proyectos from './vistas/Proyectos';
import Compras from './vistas/Compras';
import Ventas from './vistas/Ventas';
import CobrosPagos from './vistas/CobrosPagos';
import CajaBancos from './vistas/CajaBancos';
import Impuestos from './vistas/Impuestos';
import Catalogo from './vistas/Catalogo';

interface BalanceResumen {
  totalActivoMinor: string;
  totalPasivoMinor: string;
  totalPatrimonioMinor: string;
  totalResultadoMinor: string;
  cuadra: boolean;
}

const SECCIONES = [
  'Inicio',
  'Clientes y proveedores',
  'Catálogo',
  'Cotizaciones',
  'Proyectos',
  'Ventas',
  'Compras y gastos',
  'Cobros y pagos',
  'Caja y bancos',
  'Contabilidad',
  'Impuestos',
  'Respaldo',
  'Bitácora'
] as const;
type Seccion = (typeof SECCIONES)[number];

function formatoDinero(minorTexto: string): string {
  return `$${minorTexto}`;
}

function Inicio({ balance, alCargar }: { balance: BalanceResumen | null; alCargar: () => void }) {
  useEffect(() => {
    alCargar();
  }, [alCargar]);
  if (!balance) {
    return <p className="menor">Cargando resumen contable…</p>;
  }
  return (
    <div>
      <h1>Inicio</h1>
      <p className="aviso">
        Ámbito administrativo actual: ARKON no está constituida ni inscrita como contribuyente de IVA.
        Los registros aquí son control administrativo, no estados financieros legales.
      </p>
      <table>
        <tbody>
          <tr><td>Total activos</td><td className="numero">{formatoDinero(balance.totalActivoMinor)}</td></tr>
          <tr><td>Total pasivos</td><td className="numero">{formatoDinero(balance.totalPasivoMinor)}</td></tr>
          <tr><td>Total patrimonio</td><td className="numero">{formatoDinero(balance.totalPatrimonioMinor)}</td></tr>
          <tr><td>Resultado del período</td><td className="numero">{formatoDinero(balance.totalResultadoMinor)}</td></tr>
          <tr><td>Partida doble cuadra</td><td className="numero">{balance.cuadra ? 'Sí' : 'No'}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [seccion, setSeccion] = useState<Seccion>('Inicio');
  const [balance, setBalance] = useState<BalanceResumen | null>(null);

  const cargarBalance = React.useCallback(() => {
    void api()
      .invocar('balance:resumen')
      .then(r => setBalance(r as BalanceResumen))
      .catch(() => setBalance(null));
  }, []);

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">ARKON Contabilidad</div>
        <nav>
          {SECCIONES.map(s => (
            <button key={s} className={s === seccion ? 'activo' : ''} onClick={() => setSeccion(s)}>
              {s}
            </button>
          ))}
        </nav>
      </aside>
      <main className="contenido">
        {seccion === 'Inicio' && <Inicio balance={balance} alCargar={cargarBalance} />}
        {seccion === 'Clientes y proveedores' && <Contrapartes />}
        {seccion === 'Catálogo' && <Catalogo />}
        {seccion === 'Cotizaciones' && <Cotizaciones />}
        {seccion === 'Proyectos' && <Proyectos />}
        {seccion === 'Ventas' && <Ventas />}
        {seccion === 'Compras y gastos' && <Compras />}
        {seccion === 'Cobros y pagos' && <CobrosPagos />}
        {seccion === 'Caja y bancos' && <CajaBancos />}
        {seccion === 'Contabilidad' && <Contabilidad alCambiar={cargarBalance} />}
        {seccion === 'Impuestos' && <Impuestos />}
        {seccion === 'Respaldo' && <Respaldo />}
        {seccion === 'Bitácora' && <Bitacora />}
      </main>
    </div>
  );
}
