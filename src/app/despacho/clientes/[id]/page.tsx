import { Suspense } from "react";
import Link from "next/link";
import { obtenerFichaConsulta } from "@/consultas/clientes";
import { FormularioCliente } from "@/components/clientes/formulario-cliente";
import { PrivacidadCliente } from "@/components/clientes/privacidad-cliente";
import { EstadoCliente } from "@/components/clientes/estado-cliente";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";

type Props = { params: Promise<{ id: string }> };

async function Ficha({ params }: Props) {
  const { id } = await params;
  const resultado = await obtenerFichaConsulta(id);
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  const ficha = resultado.valor;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/despacho/clientes" className="text-sm text-muted-foreground hover:underline">
          Clientes /
        </Link>
        <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight">{ficha.cliente.nombre}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ficha del cliente · {ficha.cliente.activo ? "Activo" : "Inactivo"}
        </p>
      </div>
      <section aria-label="Estado de la ficha guardada" className="rounded-xl border bg-background p-5">
        <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">
          Estado de los datos guardados
        </p>
        <EstadoCliente faltantes={ficha.faltantes} motivos={ficha.motivosHoy} />
      </section>
      <FormularioCliente key={id} ficha={ficha} estiloMapaUrl={ficha.estiloMapaUrl} />
      <PrivacidadCliente
        key={`${id}-${ficha.cliente.privacidad?.id ?? "sin-registro"}-${ficha.versionAvisoVigente}`}
        clienteId={id}
        privacidad={ficha.cliente.privacidad}
        versionAviso={ficha.versionAvisoVigente}
        puedeEditar={ficha.puedeEditar}
      />
    </div>
  );
}

export default function PaginaFicha(props: Props) {
  return (
    <Suspense fallback={<p role="status">Cargando ficha…</p>}>
      <Ficha {...props} />
    </Suspense>
  );
}
