import Link from "next/link";
import type { FichaCartera } from "@/consultas/cartera.nucleo";
import { ETIQUETA_CANAL, ETIQUETA_ESTADO_SOLICITUD } from "@/dominio/clientes/etiquetas";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NotasCliente } from "./notas-cliente";

export function ResumenCartera({ clienteId, ficha }: { clienteId: string; ficha: FichaCartera }) {
  const { numeros: n, historial: h, ritmo } = ficha;
  const numeros = [
    ["Recolecciones completadas", n.completadas], ["No atendidas", n.noAtendidas],
    ["Última visita", n.ultimaVisita ?? "Sin visitas"], ["Veces que se pospuso", n.vecesPospuesta],
    ["Llegadas dentro de horario", n.dentroDeHorario.porcentaje === null ? "Sin datos" : `${n.dentroDeHorario.porcentaje.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`],
  ];
  return <>
    <section aria-label="Números del cliente" className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
      <div><h2 className="text-lg font-semibold">Números del cliente</h2><p className="text-sm text-muted-foreground">Últimos 90 días</p></div>
      <dl className="grid gap-5 sm:grid-cols-3">{numeros.map(([titulo, valor]) => <div key={titulo}><dt className="text-xs text-muted-foreground">{titulo}</dt><dd className="mt-1 font-mono text-xl tabular-nums">{valor}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Muestra de llegadas en horario: {n.dentroDeHorario.muestra}.</p>
      <div className="border-t pt-4"><h3 className="text-sm font-medium">Ritmo aprendido · últimos 180 días</h3><p className="mt-1 text-sm">{ritmo ? `Cada ~${ritmo.dias} días · última solicitud atendida: ${ritmo.ultima} · muestra: ${ritmo.muestra}.` : "Sin ritmo suficiente: se necesitan al menos 3 solicitudes atendidas."}</p></div>
    </section>
    <section aria-label="Historial" className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Historial</h2>
      <p className="text-xs text-muted-foreground">Más reciente primero · página {h.pagina} · hasta 20 registros por página</p>
      <h3 className="font-medium">Solicitudes</h3>
      {h.solicitudes.length === 0 ? <p className="text-sm">Sin solicitudes en esta página.</p> : <Table><TableHeader><TableRow>{["Folio", "Fecha solicitada", "Canal", "Estado", "Motivo"].map((t) => <TableHead key={t}>{t}</TableHead>)}</TableRow></TableHeader><TableBody>{h.solicitudes.map((s) => <TableRow key={s.id}><TableCell>{s.folio}</TableCell><TableCell>{s.fechaSolicitada}</TableCell><TableCell>{s.canal === "propuesta" ? "Propuesta" : ETIQUETA_CANAL[s.canal as keyof typeof ETIQUETA_CANAL] ?? s.canal}</TableCell><TableCell>{ETIQUETA_ESTADO_SOLICITUD[s.estado as keyof typeof ETIQUETA_ESTADO_SOLICITUD] ?? s.estado}</TableCell><TableCell className="whitespace-normal">{s.motivo ?? "—"}</TableCell></TableRow>)}</TableBody></Table>}
      <h3 className="font-medium">Recolecciones</h3>
      {h.recolecciones.length === 0 ? <p className="text-sm">Sin recolecciones en esta página.</p> : <Table><TableHeader><TableRow>{["Fecha", "Unidad", "Llegada real", "Dentro de horario", "Resultado", "Motivo"].map((t) => <TableHead key={t}>{t}</TableHead>)}</TableRow></TableHeader><TableBody>{h.recolecciones.map((r, i) => <TableRow key={`${r.fecha}-${r.placa}-${i}`}><TableCell>{r.fecha}</TableCell><TableCell>{r.placa}</TableCell><TableCell>{r.llegadaEn ? new Date(r.llegadaEn).toLocaleString("es-MX", { timeZone: "America/Mexico_City" }) : "Sin llegada"}</TableCell><TableCell>{r.dentroDeHorario === null ? "Sin datos" : r.dentroDeHorario ? "Sí" : "No"}</TableCell><TableCell>{r.estado === "completada" ? "Completada" : "No atendida"}</TableCell><TableCell className="whitespace-normal">{r.motivo ?? "—"}</TableCell></TableRow>)}</TableBody></Table>}
      <nav aria-label="Páginas del historial" className="flex gap-4 text-sm">{h.pagina > 1 && <Link className="underline" href={`/despacho/clientes/${clienteId}?pagina=${h.pagina - 1}`} scroll={false}>Anterior</Link>}{h.hayMas && <Link className="underline" href={`/despacho/clientes/${clienteId}?pagina=${h.pagina + 1}`} scroll={false}>Siguiente</Link>}</nav>
    </section>
    <NotasCliente clienteId={clienteId} notas={ficha.notas} puedeAnotar={ficha.puedeAnotar} />
  </>;
}
