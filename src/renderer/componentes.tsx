import React from 'react';
import logoAzul from './recursos/arkon-logo-azul.svg';

// Componentes compartidos del sistema visual ARKON (auditoría 69, bloque 1).
// Solo presentación: sin reglas contables ni acceso a datos.

export function BotonPrimario(props: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const { className = '', ...rest } = props;
  return <button type="button" className={`primario ${className}`.trim()} {...rest} />;
}

export function BotonSecundario(props: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const { className = '', ...rest } = props;
  return <button type="button" className={`secundario ${className}`.trim()} {...rest} />;
}

export function BotonPeligro(props: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const { className = '', ...rest } = props;
  return <button type="button" className={`peligro ${className}`.trim()} {...rest} />;
}

export function Campo(props: React.InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; children?: React.ReactNode }): React.JSX.Element {
  const { etiqueta, children, ...rest } = props;
  return (
    <label>
      {etiqueta}
      {children ?? <input {...rest} />}
    </label>
  );
}

export interface Columna<T> {
  encabezado: string;
  numero?: boolean;
  celda: (fila: T) => React.ReactNode;
}

export function Tabla<T>(props: { columnas: Array<Columna<T>>; filas: T[]; clave: (fila: T) => React.Key }): React.JSX.Element {
  return (
    <table>
      <thead>
        <tr>
          {props.columnas.map((c, i) => (
            <th key={i} className={c.numero ? 'numero' : ''} scope="col">{c.encabezado}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.filas.map(fila => (
          <tr key={props.clave(fila)}>
            {props.columnas.map((c, i) => (
              <td key={i} className={c.numero ? 'numero' : ''}>{c.celda(fila)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EncabezadoReporte(props: { titulo: string; periodo?: string; moneda?: string }): React.JSX.Element {
  return (
    <header className="encabezado-reporte">
      <img className="logo-impresion" src={logoAzul} alt="ARKON Ingeniería Eléctrica" />
      <h2>{props.titulo}</h2>
      {(props.periodo || props.moneda) && (
        <p className="menor">
          {props.periodo ? `Período: ${props.periodo}. ` : ''}
          {props.moneda ? `Moneda: ${props.moneda}.` : ''}
        </p>
      )}
    </header>
  );
}

export function EstadoCarga(props: { texto: string }): React.JSX.Element {
  return <p className="estado-carga">{props.texto}</p>;
}

export function EstadoError(props: { mensaje: string }): React.JSX.Element {
  return <p className="estado-error" role="alert">{props.mensaje}</p>;
}

export function EstadoVacio(props: { texto: string }): React.JSX.Element {
  return <p className="estado-vacio">{props.texto}</p>;
}

export function EstadoSinResultados(props: { texto: string }): React.JSX.Element {
  return <p className="estado-sin-resultados">{props.texto}</p>;
}

// Menú de acciones de fila (bloque 5): con las acciones menos frecuentes agrupadas
// quedan a lo sumo dos acciones visibles por fila. Solo presentación: los ítems
// que se pasan como children son botones normales con etiquetas claras.
export function MenuAccionesFila(props: { etiqueta: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <details className="menu-acciones">
      <summary>{props.etiqueta}</summary>
      <div
        className="menu-acciones-lista"
        onClick={e => {
          // Cerrar el menú al elegir una acción dentro de él.
          const abierto = e.currentTarget.closest('details');
          if (abierto) abierto.open = false;
        }}
      >
        {props.children}
      </div>
    </details>
  );
}

// Cifras de dinero para pantalla e impresión con separador de miles (auditoría 70).
// Los CSV y los cálculos NO usan este formato: solo presentación.
export function formatoDineroPantalla(minorTexto: string): string {
  const negativo = minorTexto.startsWith('-');
  const cuerpo = negativo ? minorTexto.slice(1) : minorTexto;
  const partes = cuerpo.split('.');
  const entero = partes[0] ?? '0';
  const decimales = partes[1] ?? '00';
  const conSeparador = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negativo ? '-$' : '$'}${conSeparador}.${decimales}`;
}
