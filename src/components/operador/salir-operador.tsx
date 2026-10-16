"use client";
import { BotonSalir } from "@/components/sesion/boton-salir";
/** Intercepta antes de que BotonSalir borre los datos, sin cambiar el componente compartido. */
export function SalirOperador({ usuarioId }: { usuarioId: string }) {
  return <div onClickCapture={e => {
    let cantidad = 0;
    try {
      for (const clave of Object.keys(localStorage)) if (clave.startsWith(`rs-operador:${usuarioId}:`))
        cantidad += JSON.parse(localStorage.getItem(clave) ?? "{}").cola?.length ?? 0;
    } catch { cantidad = 1; }
    if (cantidad && !window.confirm(`Se perderán ${cantidad} eventos; mejor espera a tener señal. ¿Cerrar sesión?`)) {
      e.preventDefault(); e.stopPropagation();
    }
  }}><BotonSalir /></div>;
}
