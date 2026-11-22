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
  if (p.avisos > 0) return `Se puede generar el plan. Revisa ${p.avisos === 1 ? "1 aviso" : `${p.avisos} avisos`}: algunas solicitudes no se atenderán.`;
  return "Nada impide generar el plan. El motor arma las rutas y pospone, con su motivo, lo que no alcance a atenderse.";
}

export function ListaPreparacion({ preparacion }: { preparacion: Preparacion }) {
  const color = preparacion.faltan > 0 ? "border-red-300 bg-red-50" : preparacion.avisos > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50";
  return <section aria-label="Antes de generar" className="space-y-3 rounded-xl border p-4">
    <details className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">¿Cómo funciona el plan del día?</summary>
      {/* Tablero del día (2026-11-21): quién hace cada paso y dónde se ve el avance. */}
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>En <strong>Jornada</strong> asignas qué camión sale con qué operador, y en <strong>Solicitudes</strong> registras las recolecciones.</li>
        <li>Aquí pulsas <strong>Generar plan</strong>: el sistema arma los viajes de cada camión. Los revisas, los ajustas si hace falta y pulsas <strong>Validar</strong>.</li>
        <li>Cada operador marca su avance en su teléfono (salió, llegó, terminó). Si no puede, tú lo marcas aquí mismo, en el tablero de cada camión.</li>
        <li>Debajo del plan validado, en <strong>Seguimiento</strong>, ves cada camión con sus viajes y qué recolecciones van hechas, en camino o pendientes.</li>
      </ol>
    </details>
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
