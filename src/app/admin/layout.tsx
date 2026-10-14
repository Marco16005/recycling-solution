import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BotonSalir } from "@/components/sesion/boton-salir";
import { usuarioDeLaSesion } from "@/consultas/sesion";

/** Lee la sesión; por eso va dentro de <Suspense>. Solo administradores. */
async function Encabezado() {
  const usuario = await usuarioDeLaSesion();
  if (usuario === null) redirect("/entrar");
  if (usuario.rol !== "admin") redirect("/sin-acceso");
  return (
    <div className="flex items-center gap-3 text-sm">
      <span>{usuario.nombre}</span>
      <BotonSalir />
    </div>
  );
}

export default function LayoutAdmin({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label="Administración">
            <span className="font-semibold">Recycling Solution · Administración</span>
            <Link href="/admin/usuarios" className="hover:underline">Usuarios</Link>
            <Link href="/admin/configuracion" className="hover:underline">Configuración</Link>
            <Link href="/despacho/clientes" className="hover:underline">Ir a despacho</Link>
          </nav>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando sesión…</p>}>
            <Encabezado />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
