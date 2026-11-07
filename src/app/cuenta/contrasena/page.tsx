import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FormularioClave } from "@/components/sesion/formulario-clave";
import { cuentaDeLaSesion } from "@/consultas/sesion";

export const metadata = { title: "Mi contraseña · Recycling Solution" };

/** Lee la sesión; por eso va dentro de <Suspense>. */
async function Contenido() {
  const cuenta = await cuentaDeLaSesion();
  if (cuenta === null) redirect("/entrar");
  return (
    <div className="flex flex-col gap-6">
      {cuenta.debeCambiarClave && (
        <div role="status" className="rounded-lg border border-amber-600/40 bg-background p-4 text-sm">
          Entraste con una contraseña temporal. Elige una nueva para continuar; solo tú la vas a conocer.
        </div>
      )}
      <FormularioClave correo={cuenta.correo} obligatorio={cuenta.debeCambiarClave} />
    </div>
  );
}

export default function PaginaMiContrasena() {
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Mi contraseña</h1>
        <p className="text-sm text-muted-foreground">Al cambiarla se cierran tus sesiones en otros equipos; esta sigue abierta.</p>
      </div>
      <Suspense fallback={<p role="status">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </section>
  );
}
