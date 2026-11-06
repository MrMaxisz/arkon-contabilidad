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
import Reportes from './vistas/Reportes';
import Ajustes from './vistas/Ajustes';
import Cierre from './vistas/Cierre';
import { EstadoCarga, formatoDineroPantalla } from './componentes';
import logoBlanco from './recursos/arkon-logo-blanco.svg';

interface BalanceResumen {
  totalActivoMinor: string;
  totalPasivoMinor: string;
  totalPatrimonioMinor: string;
  totalResultadoMinor: string;
  cuadra: boolean;
}

type Seccion =
  | 'Inicio'
  | 'Clientes y proveedores'
  | 'Catálogo'
  | 'Cotizaciones'
  | 'Proyectos'
  | 'Ventas'
  | 'Compras y gastos'
  | 'Cobros y pagos'
  | 'Caja y bancos'
  | 'Contabilidad'
  | 'Ajustes'
  | 'Cierre'
  | 'Reportes'
  | 'Impuestos'
  | 'Respaldo'
  | 'Bitácora';

const NAVEGACION: Array<{ grupo: string; destinos: Seccion[] }> = [
  { grupo: 'Inicio', destinos: ['Inicio'] },
  { grupo: 'Comercial', destinos: ['Clientes y proveedores', 'Catálogo', 'Cotizaciones', 'Proyectos', 'Ventas'] },
  { grupo: 'Compras y tesorería', destinos: ['Compras y gastos', 'Cobros y pagos', 'Caja y bancos'] },
  { grupo: 'Contabilidad', destinos: ['Contabilidad', 'Ajustes', 'Cierre', 'Reportes'] },
  { grupo: 'Fiscal', destinos: ['Impuestos'] },
  { grupo: 'Sistema', destinos: ['Respaldo', 'Bitácora'] }
];

function formatoDinero(minorTexto: string): string {
  return formatoDineroPantalla(minorTexto);
}

function Inicio({ balance, alCargar }: { balance: BalanceResumen | null; alCargar: () => void }) {
  useEffect(() => {
    alCargar();
  }, [alCargar]);
  if (!balance) {
    return <EstadoCarga texto="Cargando resumen contable…" />;
  }
  return (
    <div>
      <h1>Inicio</h1>
      <p className="aviso">
        Ámbito administrativo actual: ARKON no está constituida ni inscrita como contribuyente de IVA.
        Los registros aquí son de control administrativo, no estados financieros legales.
      </p>
      <div className="resumen-inicio">
        <div>
          <h3>Total activos</h3>
          <p className="resumen-cifra">{formatoDinero(balance.totalActivoMinor)}</p>
        </div>
        <div>
          <h3>Total pasivos</h3>
          <p className="resumen-cifra">{formatoDinero(balance.totalPasivoMinor)}</p>
        </div>
        <div>
          <h3>Total patrimonio</h3>
          <p className="resumen-cifra">{formatoDinero(balance.totalPatrimonioMinor)}</p>
        </div>
        <div>
          <h3>Resultado del período</h3>
          <p className="resumen-cifra">{formatoDinero(balance.totalResultadoMinor)}</p>
        </div>
      </div>
      <p className="menor">
        Partida doble: {balance.cuadra ? 'cuadra' : 'no cuadra'}. Use Reportes para el detalle por cuenta y auxiliares.
      </p>
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
        <div className="marca">
          <img src={logoBlanco} alt="ARKON Ingeniería Eléctrica" width={148} height={52} />
        </div>
        <nav aria-label="Secciones">
          {NAVEGACION.map(grupo => (
            <React.Fragment key={grupo.grupo}>
              {grupo.grupo !== 'Inicio' && <span className="grupo">{grupo.grupo}</span>}
              {grupo.destinos.map(destino => (
                <button
                  key={destino}
                  onClick={() => setSeccion(destino)}
                  aria-current={destino === seccion ? 'page' : undefined}
                >
                  {destino}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="pie">
          <p className="lema">Potencia con precisión</p>
        </div>
      </aside>
      <main className="contenido">
        <div className="barra-contexto">
          <span className="seccion-actual">{seccion}</span>
          <span>Ámbito administrativo · ARKON sin constituir · registros de control administrativo, no estados financieros legales</span>
        </div>
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
        {seccion === 'Ajustes' && <Ajustes />}
        {seccion === 'Cierre' && <Cierre />}
        {seccion === 'Reportes' && <Reportes />}
        {seccion === 'Impuestos' && <Impuestos />}
        {seccion === 'Respaldo' && <Respaldo />}
        {seccion === 'Bitácora' && <Bitacora />}
      </main>
    </div>
  );
}
