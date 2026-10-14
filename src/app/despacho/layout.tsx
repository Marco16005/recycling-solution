import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { usuarioDeLaSesion } from "@/consultas/sesion";
import { BotonSalir } from "@/components/sesion/boton-salir";

async function SesionDespacho() {
  const usuario = await usuarioDeLaSesion();
  if (!usuario) redirect("/entrar");
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm">
      <span className="max-w-48 truncate">{usuario.nombre}</span>
      <BotonSalir />
    </div>
  );
}

export default function DespachoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:block focus:p-3">
        Saltar al contenido
      </a>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Link href="/despacho/clientes" className="flex items-center gap-3 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-sm bg-primary text-xs text-primary-foreground"
            >
              RS
            </span>
            Recycling Solution{" "}
            <span
              className={
                "hidden border-l pl-3 text-xs font-normal uppercase " +
                "tracking-widest text-muted-foreground sm:inline"
              }
            >
              Despacho
            </span>
          </Link>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando sesión…</p>}>
            <SesionDespacho />
          </Suspense>
        </div>
      </header>
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        {children}
      </main>
    </div>
  );
}
