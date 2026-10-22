"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { guardarConfiguracionAccion } from "@/acciones/configuracion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConfiguracionVista } from "@/consultas/configuracion";
import { DIAS_SEMANA } from "@/dominio/clientes/etiquetas";
import { useHidratado } from "./hidratado";

const SelectorUbicacion = dynamic(() => import("@/components/clientes/selector-ubicacion").then((m) => m.SelectorUbicacion), {
  ssr: false,
  loading: () => <p className="flex h-72 items-center justify-center rounded-lg border text-sm text-muted-foreground">Cargando mapa…</p>,
});

type Valores = Omit<ConfiguracionVista, "version" | "versionAvisoPrivacidad" | "estiloMapaUrl">;

const CAMPOS_NUMERICOS: { campo: keyof Valores; titulo: string; paso: string; nota?: string }[] = [
  { campo: "factorCamion", titulo: "Factor de camión (tiempos de auto del mapa × factor)", paso: "0.05" },
  { campo: "umbralAtrasoMin", titulo: "Avisar atraso a partir de (min)", paso: "1" },
  {
    campo: "toleranciaReadmisionMin", titulo: "Tolerancia para una parada extra (min de tiempo muerto)", paso: "1",
    nota: "Si una parada extra alarga el día más que esto, se queda para otro día.",
  },
  { campo: "velocidadKmh", titulo: "Velocidad promedio (km/h, respaldo sin mapa)", paso: "1" },
  { campo: "factorCircuidad", titulo: "Factor de circuidad (respaldo sin mapa: calles contra línea recta)", paso: "0.05" },
  { campo: "descargaMin", titulo: "Descarga en el patio (min por viaje)", paso: "1" },
  { campo: "cargaPorOmisionKg", titulo: "Carga por omisión si no hay estimación (kg)", paso: "50" },
  { campo: "diasParaAtrasada", titulo: "Días de operación para marcar una solicitud atrasada", paso: "1" },
];

export function FormularioConfiguracion({ configuracion }: { configuracion: ConfiguracionVista }) {
  const router = useRouter();
  const hidratado = useHidratado();
  const [enCurso, iniciar] = useTransition();
  const pendiente = enCurso || !hidratado;
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [mensaje, setMensaje] = useState("");
  const { version: versionInicial, versionAvisoPrivacidad, estiloMapaUrl, ...inicial } = configuracion;
  const [valores, setValores] = useState<Valores>(inicial);
  // La versión avanza con cada guardado propio; el formulario no se reinicia, así el mensaje sigue visible.
  const [version, setVersion] = useState(versionInicial);

  const cambiar = <K extends keyof Valores>(campo: K, valor: Valores[K]) => {
    setValores((v) => ({ ...v, [campo]: valor }));
    setMensaje("");
  };

  function guardar(evento: FormEvent) {
    evento.preventDefault();
    setErrores({});
    iniciar(async () => {
      const r = await guardarConfiguracionAccion(version, valores);
      if (r.ok) {
        setVersion(r.valor.version);
        setMensaje("Configuración guardada.");
        router.refresh();
        return;
      }
      if (r.error === "no_autenticado") router.replace("/entrar");
      else if (r.error === "invalido") setErrores(r.campos);
      else if (r.error === "conflicto") setErrores({ _: ["Alguien más cambió la configuración. Recarga la página."] });
      else setErrores({ _: ["Tu cuenta no puede cambiar la configuración."] });
    });
  }

  const error = (campo: string) =>
    errores[campo]?.length ? <p id={`error-${campo}`} className="text-sm text-destructive">{errores[campo].join(" ")}</p> : null;

  return (
    <form onSubmit={guardar} className="space-y-6" aria-label="Configuración de operación">
      {Object.keys(errores).length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-background p-4 text-sm">
          <ul className="list-inside list-disc">{Object.values(errores).flat().map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {mensaje && <p role="status" className="rounded-lg border bg-background p-4 text-sm">{mensaje}</p>}

      <section className="space-y-4 rounded-xl border bg-background p-5">
        <h2 className="text-lg font-semibold">Patio</h2>
        <p className="text-sm text-muted-foreground">Punto de salida y regreso de las unidades. Haz clic en el mapa o captura las coordenadas.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["patioLat", "patioLng"] as const).map((campo) => (
            <div key={campo} className="space-y-2">
              <Label htmlFor={campo}>{campo === "patioLat" ? "Latitud" : "Longitud"}</Label>
              <Input
                id={campo}
                type="number"
                step="any"
                value={valores[campo] ?? ""}
                aria-invalid={Boolean(errores[campo])}
                aria-describedby={errores[campo] ? `error-${campo}` : undefined}
                onChange={(e) => cambiar(campo, e.target.value === "" ? null : Number(e.target.value))}
              />
              {error(campo)}
            </div>
          ))}
        </div>
        <SelectorUbicacion
          lat={valores.patioLat}
          lng={valores.patioLng}
          estiloMapaUrl={estiloMapaUrl}
          soloLectura={pendiente}
          alCambiar={(lat, lng) => setValores((v) => ({ ...v, patioLat: lat, patioLng: lng }))}
        />
      </section>

      <section className="grid gap-4 rounded-xl border bg-background p-5 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">Turno y tiempos</h2>
        {(["turnoInicio", "turnoFin"] as const).map((campo) => (
          <div key={campo} className="space-y-2">
            <Label htmlFor={campo}>{campo === "turnoInicio" ? "Inicio del turno" : "Fin del turno (incluye regreso y descarga)"}</Label>
            <Input
              id={campo}
              type="time"
              value={valores[campo]}
              aria-invalid={Boolean(errores[campo])}
              aria-describedby={errores[campo] ? `error-${campo}` : undefined}
              onChange={(e) => cambiar(campo, e.target.value)}
            />
            {error(campo)}
          </div>
        ))}
        {CAMPOS_NUMERICOS.map(({ campo, titulo, paso, nota }) => (
          <div key={campo} className="space-y-2">
            <Label htmlFor={campo}>{titulo}</Label>
            <Input
              id={campo}
              type="number"
              step={paso}
              value={String(valores[campo])}
              aria-invalid={Boolean(errores[campo])}
              aria-describedby={[nota && `nota-${campo}`, errores[campo] && `error-${campo}`].filter(Boolean).join(" ") || undefined}
              onChange={(e) => cambiar(campo, Number(e.target.value))}
            />
            {nota && <p id={`nota-${campo}`} className="text-xs text-muted-foreground">{nota}</p>}
            {error(campo)}
          </div>
        ))}
      </section>

      <fieldset className="space-y-3 rounded-xl border bg-background p-5">
        <legend className="px-1 text-lg font-semibold">Horas pico</legend>
        <p className="text-sm text-muted-foreground">
          En cada franja, los traslados tardan factor veces más que con calles libres. Valores supuestos hasta calibrarlos en el
          piloto con los tiempos reales de la flota.
        </p>
        {valores.horasPico.length === 0 && <p className="text-sm">Sin franjas: los traslados no cambian con la hora.</p>}
        <ul className="space-y-3">
          {valores.horasPico.map((franja, i) => {
            const fijar = (cambios: Partial<typeof franja>) =>
              cambiar("horasPico", valores.horasPico.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
            return (
              <li key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label={`Franja ${i + 1}`}>
                <div className="space-y-2">
                  <Label htmlFor={`pico-inicio-${i}`}>Inicio</Label>
                  <Input id={`pico-inicio-${i}`} type="time" value={franja.inicio} onChange={(e) => fijar({ inicio: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`pico-fin-${i}`}>Fin</Label>
                  <Input id={`pico-fin-${i}`} type="time" value={franja.fin} onChange={(e) => fijar({ fin: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`pico-factor-${i}`}>Factor</Label>
                  <Input id={`pico-factor-${i}`} type="number" step="0.05" min="1" max="3" value={String(franja.factor)}
                    onChange={(e) => fijar({ factor: Number(e.target.value) })} />
                </div>
                <Button type="button" variant="outline" onClick={() => cambiar("horasPico", valores.horasPico.filter((_, j) => j !== i))}>
                  Quitar
                </Button>
              </li>
            );
          })}
        </ul>
        {valores.horasPico.length < 6 && (
          <Button type="button" variant="outline" onClick={() => cambiar("horasPico", [...valores.horasPico, { inicio: "07:00", fin: "08:00", factor: 1.2 }])}>
            Agregar franja
          </Button>
        )}
        {error("horasPico")}
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border bg-background p-5">
        <legend className="px-1 text-lg font-semibold">Días de operación</legend>
        <div className="flex flex-wrap gap-4">
          {DIAS_SEMANA.map((dia, n) => (
            <label key={dia} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={valores.diasOperacion.includes(n)}
                onChange={(e) =>
                  cambiar("diasOperacion", e.target.checked ? [...valores.diasOperacion, n] : valores.diasOperacion.filter((d) => d !== n))
                }
              />
              {dia}
            </label>
          ))}
        </div>
        {error("diasOperacion")}
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border bg-background p-5 sm:grid-cols-3">
        <legend className="px-1 text-lg font-semibold">Línea base de K2 (captura de una solicitud)</legend>
        <p className="text-sm text-muted-foreground sm:col-span-3">
          Se cronometra con el método actual antes del piloto, desde que se empieza a tomar la solicitud hasta que queda registrada.
          Las líneas base de espera ({valores.lineaBase.esperaMin} min), traslado ({valores.lineaBase.trasladoMin} min) y ciclo
          ({valores.lineaBase.cicloMin} min) vienen del Documento Integrador.
        </p>
        {([
          ["k2Seg", "Mediana (segundos)", "number"],
          ["k2Muestra", "Capturas cronometradas", "number"],
          ["k2Fecha", "Fecha de la medición", "date"],
        ] as const).map(([campo, titulo, tipo]) => (
          <div key={campo} className="space-y-2">
            <Label htmlFor={campo}>{titulo}</Label>
            <Input
              id={campo}
              type={tipo}
              value={valores.lineaBase[campo] ?? ""}
              aria-invalid={Boolean(errores["lineaBase"])}
              onChange={(e) => {
                const texto = e.target.value;
                const nuevo = texto === "" ? undefined : tipo === "number" ? Number(texto) : texto;
                cambiar("lineaBase", { ...valores.lineaBase, [campo]: nuevo });
              }}
            />
          </div>
        ))}
        <div className="sm:col-span-3">{error("lineaBase")}</div>
      </fieldset>

      <p className="text-sm text-muted-foreground">
        Versión vigente del aviso de privacidad: <strong>{versionAvisoPrivacidad}</strong>. Se cambia publicando una versión nueva con
        <code className="mx-1">publicar-aviso</code>(ver docs/operacion.md).
      </p>
      <Button type="submit" disabled={pendiente}>{enCurso ? "Guardando…" : "Guardar configuración"}</Button>
    </form>
  );
}
