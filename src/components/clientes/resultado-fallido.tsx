import { notFound, redirect } from "next/navigation";
import type { guardarClienteAccion } from "@/acciones/clientes";

export type Fallo = Extract<Awaited<ReturnType<typeof guardarClienteAccion>>, { ok: false }>;

/** También se renderiza tras acciones del navegador: los saltos de Next ocurren durante el render. */
export function ResultadoFallido({ resultado }: { resultado: Fallo }) {
  if (resultado.error === "no_autenticado") redirect("/entrar");
  if (resultado.error === "no_autorizado") redirect("/sin-acceso");
  if (resultado.error === "no_encontrado") notFound();
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">
      {resultado.error === "invalido" ? (
        <ul className="list-inside list-disc">
          {Object.entries(resultado.campos).flatMap(([campo, mensajes]) =>
            mensajes.map((mensaje, i) => <li key={`${campo}-${i}`}>{mensaje}</li>),
          )}
        </ul>
      ) : (
        <p>Los datos cambiaron. Vuelve a consultar la información.</p>
      )}
    </div>
  );
}
