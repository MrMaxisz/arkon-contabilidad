import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface FilaAuxiliar {
  contraparteId: number;
  contraparteNombre: string;
  saldoMinor: string;
}

interface AuxiliarContrapartes {
  clientes: FilaAuxiliar[];
  proveedores: FilaAuxiliar[];
  totalClientesMinor: string;
  totalProveedoresMinor: string;
  conciliaMayor: boolean;
}

interface FilaAuxiliarEfectivo {
  cuentaId: number;
  codigo: string;
  nombre: string;
  saldoMinor: string;
}

interface AuxiliarEfectivo {
  cuentas: FilaAuxiliarEfectivo[];
  totalMinor: string;
  conciliaMayor: boolean;
}

export default function Reportes() {
  const [auxiliarContrapartes, setAuxiliarContrapartes] = useState<AuxiliarContrapartes | null>(null);
  const [auxiliarEfectivo, setAuxiliarEfectivo] = useState<AuxiliarEfectivo | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(() => {
    void api().invocar('auxiliar:contrapartes').then(r => setAuxiliarContrapartes(r as AuxiliarContrapartes));
    void api().invocar('auxiliar:efectivo').then(r => setAuxiliarEfectivo(r as AuxiliarEfectivo));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      <h1>Reportes y auxiliares</h1>
      {mensaje && <p className="aviso">{mensaje}</p>}

      <h2>Auxiliar de clientes</h2>
      {auxiliarContrapartes && auxiliarContrapartes.clientes.length > 0 ? (
        <>
          <table>
            <thead><tr><th>Cliente</th><th className="numero">Saldo por cobrar</th></tr></thead>
            <tbody>
              {auxiliarContrapartes.clientes.map(c => (
                <tr key={c.contraparteId}>
                  <td>{c.contraparteNombre}</td>
                  <td className="numero">${c.saldoMinor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="menor">Total clientes: ${auxiliarContrapartes.totalClientesMinor}</p>
        </>
      ) : (
        <p className="vacio">Sin saldos pendientes de clientes.</p>
      )}

      <h2>Auxiliar de proveedores</h2>
      {auxiliarContrapartes && auxiliarContrapartes.proveedores.length > 0 ? (
        <>
          <table>
            <thead><tr><th>Proveedor</th><th className="numero">Saldo por pagar</th></tr></thead>
            <tbody>
              {auxiliarContrapartes.proveedores.map(p => (
                <tr key={p.contraparteId}>
                  <td>{p.contraparteNombre}</td>
                  <td className="numero">${p.saldoMinor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="menor">Total proveedores: ${auxiliarContrapartes.totalProveedoresMinor}</p>
        </>
      ) : (
        <p className="vacio">Sin saldos pendientes de proveedores.</p>
      )}

      {auxiliarContrapartes && (
        <p className={`aviso ${auxiliarContrapartes.conciliaMayor ? 'ok' : 'error'}`}>
          {auxiliarContrapartes.conciliaMayor
            ? 'Los auxiliares de clientes y proveedores concilian con el mayor.'
            : 'Los auxiliares de clientes y proveedores NO concilian con el mayor; revisa las operaciones.'}
        </p>
      )}

      <h2>Auxiliar de caja y bancos</h2>
      {auxiliarEfectivo && auxiliarEfectivo.cuentas.length > 0 ? (
        <>
          <table>
            <thead><tr><th>Cuenta</th><th className="numero">Saldo</th></tr></thead>
            <tbody>
              {auxiliarEfectivo.cuentas.map(c => (
                <tr key={c.cuentaId}>
                  <td>{c.codigo} · {c.nombre}</td>
                  <td className="numero">${c.saldoMinor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="menor">Total efectivo: ${auxiliarEfectivo.totalMinor}</p>
        </>
      ) : (
        <p className="vacio">Sin movimientos de efectivo.</p>
      )}
      {auxiliarEfectivo && (
        <p className={`aviso ${auxiliarEfectivo.conciliaMayor ? 'ok' : 'error'}`}>
          {auxiliarEfectivo.conciliaMayor
            ? 'El auxiliar de caja y bancos concilia con el mayor.'
            : 'El auxiliar de caja y bancos NO concilia con el mayor.'}
        </p>
      )}
      <p className="menor">
        Los auxiliares derivan de asientos y aplicaciones; no almacenan saldos independientes.
        El cierre contable de ejercicio se completa después con reglas explícitas.
      </p>
    </div>
  );
}
