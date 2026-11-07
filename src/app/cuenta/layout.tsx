import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SalirOperador } from "@/components/operador/salir-operador";
import { BotonSalir } from "@/components/sesion/boton-salir";
import { buttonVariants } from "@/components/ui/button";
import { cuentaDeLaSesion } from "@/consultas/sesion";

/**
 * Lee la sesión; por eso va dentro de <Suspense>. Sirve a los cuatro roles. Usa cuentaDeLaSesion, que no redirige a
 * esta misma pantalla cuando la contraseña es temporal. "Volver" se oculta mientras el cambio sea obligatorio.
 */
async function Encabezado() {
  const cuenta = await cuentaDeLaSesion();
  if (cuenta === null) redirect("/entrar");
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span className="min-w-0 max-w-48 truncate">{cuenta.nombre}</span>
      {!cuenta.debeCambiarClave && <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" })}>Volver</Link>}
      {/* El operador puede tener eventos sin enviar: su Salir avisa antes de borrar lo guardado en el teléfono. */}
      {cuenta.rol === "operador" ? <SalirOperador usuarioId={cuenta.usuarioId} /> : <BotonSalir />}
    </div>
  );
}

export default function LayoutCuenta({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <span className="flex items-center gap-3 font-semibold tracking-tight">
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-sm bg-primary text-xs text-primary-foreground">RS</span>
            Recycling Solution
          </span>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando sesión…</p>}>
            <Encabezado />
          </Suspense>
        </div>
      </header>
      <main id="contenido" className="mx-auto max-w-md px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
