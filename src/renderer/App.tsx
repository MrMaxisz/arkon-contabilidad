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
import LibroDiario from './vistas/LibroDiario';
import EstadosFinancieros from './vistas/EstadosFinancieros';
import ActivosFijos from './vistas/ActivosFijos';
import Costos from './vistas/Costos';
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
  | 'Activos fijos'
  | 'Libro diario'
  | 'Estados financieros'
  | 'Costos'
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
  { grupo: 'Contabilidad', destinos: ['Contabilidad', 'Activos fijos', 'Libro diario', 'Estados financieros', 'Costos', 'Ajustes', 'Cierre', 'Reportes'] },
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
  const esAndroid = api().plataforma === 'android';
  const navegacion = esAndroid
    ? NAVEGACION.map(grupo => ({ ...grupo, destinos: grupo.destinos.filter(d => d !== 'Impuestos' && d !== 'Respaldo') })).filter(grupo => grupo.destinos.length > 0)
    : NAVEGACION;
  const [seccion, setSeccion] = useState<Seccion>('Inicio');
  const [balance, setBalance] = useState<BalanceResumen | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);

  const cargarBalance = React.useCallback(() => {
    void api()
      .invocar('balance:resumen')
      .then(r => setBalance(r as BalanceResumen))
      .catch(() => setBalance(null));
  }, []);

  return (
    <div className={`app${menuAbierto ? ' menu-abierto' : ''}`}>
      {esAndroid && (
        <header className="cabecera-movil">
          <button className="menu-movil" aria-expanded={menuAbierto} aria-controls="menu-principal" aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'} onClick={() => setMenuAbierto(!menuAbierto)}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          </button>
          <img src={logoBlanco} alt="ARKON Ingeniería Eléctrica" width={80} height={28} />
          <span className="seccion-movil">{seccion}</span>
        </header>
      )}
      <aside className="lateral" id="menu-principal">
        <div className="marca">
          <img src={logoBlanco} alt="ARKON Ingeniería Eléctrica" width={148} height={52} />
        </div>
        <nav aria-label="Secciones">
          {navegacion.map(grupo => (
            <React.Fragment key={grupo.grupo}>
              {grupo.grupo !== 'Inicio' && <span className="grupo">{grupo.grupo}</span>}
              {grupo.destinos.map(destino => (
                <button
                  key={destino}
                  onClick={() => { setSeccion(destino); setMenuAbierto(false); }}
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
      {esAndroid && menuAbierto && <div className="velo-menu" onClick={() => setMenuAbierto(false)} aria-hidden="true" />}
      <main className="contenido">
        <div className="barra-contexto">
          <span className="seccion-actual">{seccion}</span>
          <span className="barra-contexto-detalle">Ámbito administrativo · ARKON sin constituir · registros de control administrativo, no estados financieros legales</span>
        </div>
        {esAndroid && seccion === 'Inicio' && <p className="aviso">Android: una base administrativa. PDF, archivos, adjuntos, respaldos y diálogos de escritorio no disponibles aún. No borre los datos de la app.</p>}
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
        {seccion === 'Activos fijos' && <ActivosFijos />}
        {seccion === 'Libro diario' && <LibroDiario />}
        {seccion === 'Estados financieros' && <EstadosFinancieros />}
        {seccion === 'Costos' && <Costos />}
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
