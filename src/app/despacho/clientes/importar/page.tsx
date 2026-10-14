import { Suspense } from "react";
import Link from "next/link";
import { obtenerContextoAltaConsulta } from "@/consultas/clientes";
import { FormularioImportar } from "@/components/clientes/formulario-importar";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";

async function Importacion() {
  // clientes.editar y clientes.importar comparten roles hoy; revisar este acceso si cambia la matriz.
  const acceso = await obtenerContextoAltaConsulta();
  if (!acceso.ok) return <ResultadoFallido resultado={acceso} />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/despacho/clientes" className="text-sm text-muted-foreground hover:underline">
          Clientes /
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Importar cartera</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Primero revisa el archivo. Después confirma el lote completo.
        </p>
      </div>
      <FormularioImportar />
    </div>
  );
}

export default function PaginaImportar() {
  return (
    <Suspense fallback={<p role="status">Preparando importación…</p>}>
      <Importacion />
    </Suspense>
  );
}
