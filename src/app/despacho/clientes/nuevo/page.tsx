import { Suspense } from "react";
import Link from "next/link";
import { obtenerContextoAltaConsulta } from "@/consultas/clientes";
import { FormularioCliente } from "@/components/clientes/formulario-cliente";
import { PrivacidadCliente } from "@/components/clientes/privacidad-cliente";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";

async function Alta() {
  const resultado = await obtenerContextoAltaConsulta();
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/despacho/clientes" className="text-sm text-muted-foreground hover:underline">
          Clientes /
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Nuevo cliente</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Puedes guardar una ficha incompleta y terminarla después.
        </p>
      </div>
      <FormularioCliente
        estiloMapaUrl={resultado.valor.estiloMapaUrl} catalogoDocumentos={resultado.valor.catalogoDocumentos}
      />
      <PrivacidadCliente
        clienteId={null}
        privacidad={null}
        versionAviso={resultado.valor.versionAvisoVigente}
        puedeEditar
      />
    </div>
  );
}

export default function PaginaNuevoCliente() {
  return (
    <Suspense fallback={<p role="status">Preparando alta…</p>}>
      <Alta />
    </Suspense>
  );
}
