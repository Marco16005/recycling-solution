import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { VistaPanel } from "@/consultas/indicadores";

type Medida = { valor: number | null; muestra: number; lineaBase?: number };

const numero = (v: number | null, decimales = 1) =>
  v === null ? "—" : v.toLocaleString("es-MX", { maximumFractionDigits: decimales, minimumFractionDigits: 0 });

function Tarjeta({ id, titulo, medida, unidad, lineaBase, meta, nota }: {
  id: string; titulo: string; medida: Medida; unidad: string; lineaBase?: number; meta?: number; nota?: string;
}) {
  const base = lineaBase ?? medida.lineaBase;
  return (
    <section aria-labelledby={id} className="space-y-2 rounded-xl border bg-background p-5">
      <h3 id={id} className="text-sm font-medium text-muted-foreground">{titulo}</h3>
      <p className="font-mono text-3xl tabular-nums">{numero(medida.valor)}<span className="ml-1 text-base text-muted-foreground">{unidad}</span></p>
      <p className="text-xs text-muted-foreground">
        Muestra: {medida.muestra}{base !== undefined && <> · Línea base: {numero(base)} {unidad}</>}{meta !== undefined && <> · Meta: {numero(meta)} {unidad}</>}
      </p>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </section>
  );
}

/** Panel de gerencia (Plan 6): indicadores contra la línea base, tendencia y exportación CSV. Solo lectura. */
export function PanelIndicadores({ vista }: { vista: VistaPanel }) {
  const { lineaBase: lb } = vista;
  const csv = `/api/indicadores/csv?desde=${vista.desde}&hasta=${vista.hasta}`;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Panel de indicadores</h1>
        <p className="text-sm text-muted-foreground">Del {vista.desde} al {vista.hasta}. Tiempos en minutos, hora de Ciudad de México.</p>
      </div>

      <form action="/gerencia/panel" method="get" aria-label="Rango de fechas" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2"><Label htmlFor="desde">Desde</Label><Input id="desde" name="desde" type="date" defaultValue={vista.desde} required /></div>
        <div className="space-y-2"><Label htmlFor="hasta">Hasta</Label><Input id="hasta" name="hasta" type="date" defaultValue={vista.hasta} required /></div>
        <Button type="submit" variant="secondary">Ver rango</Button>
        <a href={csv} className={buttonVariants({ variant: "outline" })} download>Descargar CSV (una fila por recolección)</a>
      </form>

      <section aria-labelledby="titulo-tiempos" className="space-y-4">
        <h2 id="titulo-tiempos" className="text-xl font-semibold">Tiempos por recolección</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta id="k1-espera" titulo="K1 · Espera de asignación" medida={vista.k1.espera} unidad="min" lineaBase={lb.esperaMin} />
          <Tarjeta id="k1-traslado" titulo="K1 · Traslado" medida={vista.k1.traslado} unidad="min" lineaBase={lb.trasladoMin} />
          <Tarjeta id="ciclo" titulo="Tiempo de ciclo" medida={vista.ciclo} unidad="min" lineaBase={lb.cicloMin} />
          <Tarjeta id="k2" titulo="K2 · Captura de una solicitud (mediana)" medida={{ ...vista.k2, valor: vista.k2.valor === null ? null : vista.k2.valor / 60, lineaBase: vista.k2.lineaBase === undefined ? undefined : vista.k2.lineaBase / 60 }} unidad="min"
            nota={vista.k2.lineaBase === undefined ? "Falta cronometrar la línea base de K2 (Configuración)." : undefined} />
        </div>
      </section>

      <section aria-labelledby="titulo-servicio" className="space-y-4">
        <h2 id="titulo-servicio" className="text-xl font-semibold">Servicio, distancia y datos</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta id="k3" titulo="K3 · Inicio dentro de la ventana" medida={vista.k3} unidad="%"
            nota={`No atendidas: ${vista.k3.noAtendidas} · Omitidas: ${vista.k3.omitidas} · Pendientes al cierre: ${vista.k3.pendientesAlCierre}`} />
          <Tarjeta id="k4-observado" titulo="K4 · Ahorro observado (odómetros)" medida={vista.k4.ahorroObservado} unidad="%"
            nota={`Km reales: ${numero(vista.k4.kmReales.valor)} · Contrafactual: ${numero(vista.k4.kmContrafactual)} · Litros estimados: ${numero(vista.k4.litros)}`} />
          <Tarjeta id="k4-simulado" titulo="K4 · Ahorro simulado (plan del motor)" medida={vista.k4.ahorroSimulado} unidad="%" nota="Simulado: estimación del plan, no recorrido real." />
          <Tarjeta id="k5" titulo="K5 · Fichas completas (cartera activa)" medida={vista.k5} unidad="%" />
        </div>
      </section>

      <section aria-labelledby="titulo-planeacion" className="space-y-4">
        <h2 id="titulo-planeacion" className="text-xl font-semibold">Planeación</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta id="k6-inicial" titulo="K6 · Trabajo activo, plan del día" medida={vista.k6.inicial.trabajoActivo} unidad="min" meta={vista.k6.metaMin} />
          <Tarjeta id="k6-inicial-demora" titulo="K6 · Demora total, plan del día" medida={vista.k6.inicial.demora} unidad="min"
            nota="De la generación a la validación; la meta se compara solo con el trabajo activo." />
          <Tarjeta id="k6-reruteo" titulo="K6 · Trabajo activo, re-ruteos" medida={vista.k6.re_ruteo.trabajoActivo} unidad="min" />
          <Tarjeta id="k6-reruteo-demora" titulo="K6 · Demora total, re-ruteos" medida={vista.k6.re_ruteo.demora} unidad="min" />
          <Tarjeta id="k7" titulo="K7 · Tiempo del motor (mediana)" medida={vista.k7.mediana} unidad="ms"
            nota={`Máximo: ${numero(vista.k7.maximo)} ms · Fallidas: ${vista.k7.errores} · Agotadas: ${vista.k7.agotadas}`} />
        </div>
      </section>

      <section aria-labelledby="titulo-tendencia" className="space-y-3">
        <h2 id="titulo-tendencia" className="text-xl font-semibold">Tendencia diaria</h2>
        {vista.tendencia.length === 0 ? <p className="text-sm text-muted-foreground">Sin recolecciones registradas en el rango.</p> : (
          <div className="overflow-x-auto rounded-xl border bg-background">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Indicadores por día</caption>
              <thead><tr>
                {["Fecha", "Espera (min)", "Traslado (min)", "Ventana (%)", "Ciclo (min)"].map((t) => <th key={t} scope="col" className="p-3">{t}</th>)}
              </tr></thead>
              <tbody>{vista.tendencia.map((d) => (
                <tr key={d.fecha} className="border-t">
                  <th scope="row" className="p-3 font-mono">{d.fecha}</th>
                  {[d.k1Espera, d.k1Traslado, d.k3, d.ciclo].map((m, i) => (
                    <td key={i} className="p-3 tabular-nums">{numero(m.valor)} <span className="text-xs text-muted-foreground">(n = {m.muestra})</span></td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {vista.k5.serie.length > 0 && (
        <section aria-labelledby="titulo-k5" className="space-y-3">
          <h2 id="titulo-k5" className="text-xl font-semibold">Evolución de K5</h2>
          <ul className="flex flex-wrap gap-3 text-sm">{vista.k5.serie.map((x) => <li key={x.fecha} className="rounded-lg border bg-background px-3 py-2"><span className="font-mono">{x.fecha}</span>: {numero(x.valor)} %</li>)}</ul>
        </section>
      )}
    </div>
  );
}
