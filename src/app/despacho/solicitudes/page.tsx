import { Suspense } from "react";
import { colaDeSolicitudesConsulta } from "@/consultas/solicitudes";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { SelectorFecha } from "@/components/flota/selector-fecha";
import { AltaSolicitud } from "@/components/solicitudes/alta-solicitud";
import { ColaSolicitudes } from "@/components/solicitudes/cola-solicitudes";
import { fechaEnMexico } from "@/dominio/tiempo";

type Props = { searchParams: Promise<{ fecha?: string | string[] }> };

async function Contenido({ searchParams }: Props) {
  const { fecha } = await searchParams;
  const resultado = await colaDeSolicitudesConsulta(typeof fecha === "string" ? fecha : undefined);
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  const vista = resultado.valor;
  const hoy = fechaEnMexico(new Date());
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Solicitudes</h1>
        <p className="mt-2 text-sm text-muted-foreground">Captura cada pedido y conserva su lugar en la fila.</p>
      </div>
      {vista.puedeRegistrar ? <AltaSolicitud hoy={hoy} /> : (
        <p className="text-sm text-muted-foreground">Consulta de gerencia · Solo lectura</p>
      )}
      <SelectorFecha fecha={vista.fecha} ruta="/despacho/solicitudes" />
      <ColaSolicitudes vista={vista} />
    </div>
  );
}

export default function PaginaSolicitudes(props: Props) {
  return <Suspense fallback={<p role="status">Cargando solicitudes…</p>}><Contenido {...props} /></Suspense>;
}
