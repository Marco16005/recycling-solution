import { Suspense } from "react";
import { TablaUsuarios } from "@/components/admin/tabla-usuarios";
import { mensajesDeFallo } from "@/components/admin/resultado";
import { listarUsuariosConsulta } from "@/consultas/usuarios";

async function Usuarios() {
  const r = await listarUsuariosConsulta();
  if (!r.ok) return <p role="alert">{mensajesDeFallo(r).join(" ")}</p>;
  return <TablaUsuarios {...r.valor} />;
}

export default function PaginaUsuarios() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Altas, roles y accesos. Las contraseñas temporales se muestran una sola vez: entrégalas en persona.
        </p>
      </div>
      <Suspense fallback={<p role="status">Cargando usuarios…</p>}>
        <Usuarios />
      </Suspense>
    </section>
  );
}
