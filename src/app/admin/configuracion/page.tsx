import { Suspense } from "react";
import { FormularioConfiguracion } from "@/components/admin/formulario-configuracion";
import { mensajesDeFallo } from "@/components/admin/resultado";
import { obtenerConfiguracionConsulta } from "@/consultas/configuracion";

async function Configuracion() {
  const r = await obtenerConfiguracionConsulta();
  if (!r.ok) return <p role="alert">{mensajesDeFallo(r).join(" ")}</p>;
  return <FormularioConfiguracion key={r.valor.version} configuracion={r.valor} />;
}

export default function PaginaConfiguracion() {
  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuración de operación</h1>
        <p className="text-sm text-muted-foreground">Parámetros que usa el motor de rutas y la cola de solicitudes.</p>
      </div>
      <Suspense fallback={<p role="status">Cargando configuración…</p>}>
        <Configuracion />
      </Suspense>
    </section>
  );
}
