import Link from "next/link";
import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import type { EstadoPunto, Preparacion } from "@/consultas/preparacion";

/**
 * Lista "Antes de generar" del plan del día (diseño del 2026-11-21): qué necesita el plan de esta fecha, en lenguaje
 * simple, con el enlace a la pantalla donde se corrige cada cosa. Orienta; no bloquea el botón "Generar plan".
 */

const icono: Record<EstadoPunto, { Icono: typeof CircleCheckIcon; clase: string; etiqueta: string }> = {
  bien: { Icono: CircleCheckIcon, clase: "text-emerald-600", etiqueta: "Bien" },
  aviso: { Icono: CircleAlertIcon, clase: "text-amber-600", etiqueta: "Revisar" },
  falta: { Icono: CircleXIcon, clase: "text-red-600", etiqueta: "Falta" },
};

function resumen(p: Preparacion): string {
  if (p.faltan > 0) return `Antes de generar, resuelve ${p.faltan === 1 ? "1 punto" : `${p.faltan} puntos`}: sin eso el plan no se puede generar o saldría sin rutas.`;
  if (p.avisos > 0) return `Se puede generar el plan. Revisa ${p.avisos === 1 ? "1 aviso" : `${p.avisos} avisos`}: algunas solicitudes quedarán fuera.`;
  return "Todo listo para generar el plan.";
}

export function ListaPreparacion({ preparacion }: { preparacion: Preparacion }) {
  const color = preparacion.faltan > 0 ? "border-red-300 bg-red-50" : preparacion.avisos > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50";
  return <section aria-label="Antes de generar" className="space-y-3 rounded-xl border p-4">
    <div className="space-y-1">
      <h2 className="text-lg font-semibold">Antes de generar</h2>
      <p className={`rounded-lg border px-3 py-2 text-sm font-medium ${color}`} role="status">{resumen(preparacion)}</p>
    </div>
    <ul className="space-y-3">
      {preparacion.puntos.map((punto) => {
        const { Icono, clase, etiqueta } = icono[punto.estado];
        return <li key={punto.clave} className="flex gap-3" data-estado={punto.estado}>
          <Icono aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${clase}`} />
          <div className="min-w-0 space-y-1 text-sm">
            <p><span className="font-semibold">{punto.titulo}<span className="sr-only"> ({etiqueta})</span></span> · {punto.detalle}</p>
            {punto.pendientes.length > 0 && <ul className="list-disc space-y-1 pl-5">
              {punto.pendientes.map((pendiente, i) => <li key={i}>
                {pendiente.texto}
                {pendiente.enlace && <> · <Link className="underline" href={pendiente.enlace.href}>{pendiente.enlace.texto}</Link></>}
              </li>)}
            </ul>}
            {punto.enlace && <p><Link className="font-medium underline" href={punto.enlace.href}>{punto.enlace.texto}</Link></p>}
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
