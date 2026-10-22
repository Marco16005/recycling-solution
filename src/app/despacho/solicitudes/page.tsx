import { Suspense } from "react";
import { propuestasDeRecoleccionConsulta } from "@/consultas/cartera";
import { obtenerFichaConsulta } from "@/consultas/clientes";
import { PropuestasRecoleccion, type PropuestaVista } from "@/components/solicitudes/propuestas-recoleccion";
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
  let vista = resultado.valor;
  const propuestas = vista.puedeRegistrar
    ? await propuestasDeRecoleccionConsulta(typeof fecha === "string" ? fecha : undefined)
    : null;
  let propuestasVista: PropuestaVista[] = [];
  if (propuestas?.ok) {
    // PC-0 no incluye los días de recurrencia en la propuesta. Se leen de la ficha autorizada.
    propuestasVista = await Promise.all(propuestas.valor.propuestas.map(async (p) => {
      if (!p.motivos.includes("recurrencia")) return { ...p, recurrencia: null };
      const ficha = await obtenerFichaConsulta(p.clienteId);
      return { ...p, recurrencia: ficha.ok ? ficha.valor.cliente.recurrencia : null };
    }));
    if (vista.fecha !== propuestas.valor.fecha) {
      const cola = await colaDeSolicitudesConsulta(propuestas.valor.fecha);
      if (!cola.ok) return <ResultadoFallido resultado={cola} />;
      vista = cola.valor;
    }
  }
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
      {propuestas && (propuestas.ok
        ? <PropuestasRecoleccion key={propuestas.valor.fecha} fecha={propuestas.valor.fecha} propuestas={propuestasVista} puedeConfirmar={propuestas.valor.puedeConfirmar} />
        : <ResultadoFallido resultado={propuestas} />)}
      <ColaSolicitudes vista={vista} />
    </div>
  );
}

export default function PaginaSolicitudes(props: Props) {
  return <Suspense fallback={<p role="status">Cargando solicitudes…</p>}><Contenido {...props} /></Suspense>;
}
