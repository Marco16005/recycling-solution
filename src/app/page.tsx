import { redirect } from "next/navigation";
import { Suspense } from "react";
import { usuarioDeLaSesion } from "@/consultas/sesion";

/** Lee la sesión; por eso va dentro de <Suspense> (requisito de Cache Components). */
async function Redireccion(): Promise<null> {
  const usuario = await usuarioDeLaSesion();
  if (usuario === null) redirect("/entrar");
  if (usuario.rol === "operador") redirect("/sin-acceso");
  redirect("/despacho/clientes");
}

export default function Inicio() {
  return (
    <Suspense fallback={null}>
      <Redireccion />
    </Suspense>
  );
}
