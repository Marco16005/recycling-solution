import { Suspense } from "react";
import { redirect } from "next/navigation";
import { usuarioDeLaSesion } from "@/consultas/sesion";
import { puede } from "@/seguridad/permisos";
import { RegistrarSwOperador } from "@/components/sesion/registrar-sw-operador";
import { EnlaceCuenta } from "@/components/sesion/enlace-cuenta";
import { SalirOperador } from "@/components/operador/salir-operador";

async function Sesion({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioDeLaSesion();
  if (!usuario) redirect("/entrar");
  if (!puede(usuario, "ruta.operar")) redirect("/sin-acceso");
  return <div className="mx-auto min-h-dvh max-w-xl bg-background p-4 pb-12">
    <RegistrarSwOperador usuarioId={usuario.id} />
    <header className="mb-6 flex min-w-0 items-center gap-2 border-b pb-4">
      <span className="min-w-0 flex-1 truncate font-semibold">{usuario.nombre}</span>
      <div className="flex shrink-0 items-center gap-1">
        <EnlaceCuenta />
        <SalirOperador usuarioId={usuario.id} />
      </div>
    </header>{children}</div>;
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p>Cargando sesión…</p>}><Sesion>{children}</Sesion></Suspense>;
}
