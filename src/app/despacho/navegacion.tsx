"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const secciones = [
  ["clientes", "Clientes"], ["solicitudes", "Solicitudes"], ["jornada", "Jornada"],
  ["plan", "Plan del día"], ["unidades", "Unidades"], ["operadores", "Operadores"],
] as const;

export function NavegacionDespacho({ puedeVerPanel = false }: { puedeVerPanel?: boolean }) {
  const ruta = usePathname();
  return (
    <nav aria-label="Despacho" className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 pb-3 sm:px-8">
      {secciones.map(([segmento, nombre]) => {
        const href = `/despacho/${segmento}`;
        const activa = ruta === href || ruta.startsWith(`${href}/`);
        return (
          <Link
            key={segmento} href={href} aria-current={activa ? "page" : undefined}
            className={
              "rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring " +
              (activa ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-muted")
            }
          >
            {nombre}
          </Link>
        );
      })}
      {puedeVerPanel && <Link href="/gerencia/panel" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted">Panel</Link>}
    </nav>
  );
}
