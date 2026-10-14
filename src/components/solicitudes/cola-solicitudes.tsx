import Link from "next/link";
import type { VistaCola } from "@/consultas/solicitudes";
import { Badge } from "@/components/ui/badge";
import { ETIQUETA_CANAL, ETIQUETA_ESTADO_SOLICITUD } from "@/dominio/clientes/etiquetas";
import type { EstadoEnCola } from "@/dominio/solicitudes/tipos";
import { MotivosCliente } from "./motivos-cliente";
import { AccionesSolicitud } from "./acciones-solicitud";

const etiquetas: Record<EstadoEnCola, string> = {
  lista: "Lista para planear", bloqueada: "Bloqueada", futura: "Futura", cerrada: "Cerrada",
};

export function ColaSolicitudes({ vista }: { vista: VistaCola }) {
  return (
    <section className="space-y-5" aria-label="Cola de solicitudes">
      <div>
        <h2 className="text-xl font-semibold">Cola · {vista.fecha}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Orden de registro original, de la más antigua a la más reciente.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["Listas", vista.resumen.listas], ["Bloqueadas", vista.resumen.bloqueadas],
          ["Atrasadas", vista.resumen.atrasadas], ["Futuras", vista.resumen.futuras],
        ] as const).map(([nombre, cantidad]) => (
          <div key={nombre} className="rounded-xl border bg-background p-4">
            <dt className="text-sm text-muted-foreground">{nombre}</dt>
            <dd className="mt-2 font-mono text-3xl tabular-nums">{cantidad}</dd>
          </div>
        ))}
      </dl>
      {vista.elementos.length === 0 && (
        <p className="rounded-xl border bg-background p-8 text-center text-sm">No hay solicitudes para mostrar.</p>
      )}
      <ol className="space-y-4">
        {vista.elementos.map((elemento) => {
          const s = elemento.solicitud;
          return (
            <li key={s.id} className="space-y-4 rounded-xl border bg-background p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h3 className="font-mono text-sm font-semibold">{s.folio}</h3>
                  <Link href={`/despacho/clientes/${s.clienteId}`} className="font-medium break-words hover:underline">
                    {elemento.cliente.nombre}
                  </Link>
                  <p className="text-sm text-muted-foreground">{elemento.cliente.direccion ?? "Sin dirección"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={elemento.estado === "lista" ? "secondary" : "outline"}>
                    {etiquetas[elemento.estado]}
                    {elemento.estado === "cerrada" ? ` · ${ETIQUETA_ESTADO_SOLICITUD[s.estado]}` : ""}
                  </Badge>
                  {elemento.atrasada && (
                    <Badge variant="outline">Atrasada · {elemento.diasDeAtraso} días de operación</Badge>
                  )}
                </div>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">Registrada</dt><dd>
                  <time dateTime={new Date(s.registradaEn).toISOString()}>
                    {new Date(s.registradaEn).toLocaleString("es-MX", {
                      timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short",
                    })}
                  </time>
                </dd></div>
                <div><dt className="text-muted-foreground">Fecha solicitada</dt><dd>{s.fechaSolicitada}</dd></div>
                <div>
                  <dt className="text-muted-foreground">Próxima fecha elegible</dt><dd>{s.proximaFechaElegible}</dd>
                </div>
                <div><dt className="text-muted-foreground">Canal</dt><dd>{ETIQUETA_CANAL[s.canal]}</dd></div>
                <div><dt className="text-muted-foreground">Carga capturada</dt><dd>
                  {s.cargaEstimadaKg === null
                    ? "Cliente o configuración" : `${s.cargaEstimadaKg.toLocaleString("es-MX")} kg`}
                </dd></div>
                <div><dt className="text-muted-foreground">Veces pospuesta</dt><dd>{s.vecesPospuesta}</dd></div>
              </dl>
              {elemento.motivos.length > 0 && <MotivosCliente motivos={elemento.motivos} />}
              {s.notas && <p className="text-sm whitespace-pre-wrap break-words">{s.notas}</p>}
              {s.motivoCancelacion && <p className="text-sm break-words">Cancelación: {s.motivoCancelacion}</p>}
              <AccionesSolicitud
                key={s.id} solicitud={s}
                puedeCancelar={vista.puedeCancelar} puedeRegistrar={vista.puedeRegistrar}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
