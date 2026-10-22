"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { analizarImportacionAccion, confirmarImportacionAccion } from "@/acciones/importacion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LIMITES_CSV } from "@/dominio/clientes/csv";
import { generarOperacionId } from "./generar-operacion-id";
import { Campo, ResumenErrores, type Errores } from "./campos-formulario";
import { ResultadoFallido, type Fallo } from "./resultado-fallido";

type Resumen = Extract<Awaited<ReturnType<typeof analizarImportacionAccion>>, { ok: true }>["valor"];
type Analisis = { contenido: string; resumen: Resumen; operacionId: string };

export function FormularioImportar() {
  const prefijo = useId();
  const router = useRouter();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [aceptarDuplicados, setAceptarDuplicados] = useState(false);
  const [sinConfirmacion, setSinConfirmacion] = useState(false);
  const [requiereAnalisis, setRequiereAnalisis] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [importados, setImportados] = useState<number | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [paso, setPaso] = useState<"analisis" | "confirmacion">("analisis");
  const [seleccion, setSeleccion] = useState(0);

  function mostrarFallo(resultado: Fallo) {
    if (resultado.error === "invalido") setErrores(resultado.campos);
    else if (resultado.error === "conflicto") setRequiereAnalisis(true);
    else setFallo(resultado);
  }

  function analizar(evento: FormEvent) {
    evento.preventDefault();
    if (pendiente || sinConfirmacion) return;
    setErrores({});
    setFallo(null);
    setAnalisis(null);
    setAceptarDuplicados(false);
    setImportados(null);
    if (!archivo) {
      setErrores({ archivo: ["Selecciona un archivo CSV."] });
      return;
    }
    if (archivo.size > LIMITES_CSV.bytes) {
      setErrores({ archivo: ["El archivo supera 1 MB (1 000 000 bytes)."] });
      return;
    }
    setPaso("analisis");
    iniciar(async () => {
      let contenido: string;
      try {
        const bytes = await archivo.arrayBuffer();
        try {
          contenido = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          contenido = new TextDecoder("windows-1252").decode(bytes);
        }
      } catch {
        setErrores({ archivo: ["No pudimos leer el archivo. Vuelve a seleccionarlo e inténtalo de nuevo."] });
        return;
      }
      if (new TextEncoder().encode(contenido).byteLength > LIMITES_CSV.bytes) {
        setErrores({ archivo: ["El contenido supera el límite de 1 MB en UTF-8."] });
        return;
      }

      let resultado: Awaited<ReturnType<typeof analizarImportacionAccion>>;
      try {
        resultado = await analizarImportacionAccion(contenido);
      } catch {
        setErrores({ archivo: ["No pudimos analizar el archivo. Revisa la conexión e inténtalo de nuevo."] });
        return;
      }
      if (!resultado.ok) {
        mostrarFallo(resultado);
        return;
      }
      const operacionId = generarOperacionId();
      setAnalisis({ contenido, resumen: resultado.valor, operacionId });
      setRequiereAnalisis(false);
    });
  }

  function confirmar() {
    if (
      !analisis ||
      pendiente ||
      requiereAnalisis ||
      importados !== null ||
      analisis.resumen.errores.length ||
      !analisis.resumen.validas
    )
      return;
    if (analisis.resumen.posiblesDuplicados.length && !aceptarDuplicados) {
      setErrores({ duplicados: ["Revisa y acepta los posibles duplicados para continuar."] });
      return;
    }
    setErrores({});
    setFallo(null);
    setPaso("confirmacion");
    iniciar(async () => {
      let resultado;
      try {
        resultado = await confirmarImportacionAccion(analisis.contenido, {
          operacionId: analisis.operacionId,
          huella: analisis.resumen.huella,
          aceptarDuplicados,
        });
      } catch {
        setSinConfirmacion(true);
        setErrores({
          _: [
            "No recibimos confirmación. Puedes reintentar este mismo lote sin duplicar los clientes. " +
              "No vuelvas a analizarlo para reintentar.",
          ],
        });
        return;
      }
      setSinConfirmacion(false);
      if (!resultado.ok) {
        mostrarFallo(resultado);
        return;
      }
      setImportados(resultado.valor.importados);
      router.refresh();
    });
  }

  if (importados !== null)
    return (
      <section role="status" className="space-y-5 rounded-xl border bg-background p-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Importación terminada</p>
        <h2 className="text-2xl font-semibold">{importados} clientes importados</h2>
        <p className="text-sm text-muted-foreground">
          Revisa los datos importados y registra el aviso de privacidad en cada ficha.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/despacho/clientes" className={buttonVariants()}>
            Ver clientes
          </Link>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setArchivo(null);
              setAnalisis(null);
              setImportados(null);
              setErrores({});
              setAceptarDuplicados(false);
              setSeleccion((n) => n + 1);
            }}
          >
            Importar otro archivo
          </Button>
        </div>
      </section>
    );

  return (
    <form onSubmit={analizar} noValidate className="space-y-6" aria-label="Importar clientes desde CSV">
      {fallo && <ResultadoFallido resultado={fallo} />}
      <ResumenErrores errores={errores} />
      <section
        className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
        aria-labelledby={`${prefijo}-paso-archivo`}
      >
        <h2 id={`${prefijo}-paso-archivo`} className="text-lg font-semibold">
          1 · Seleccionar y analizar
        </h2>
        <p className="text-sm text-muted-foreground">
          CSV en UTF-8 o Windows-1252, hasta {LIMITES_CSV.registros.toLocaleString("es-MX")} registros y 1 MB. Acepta coma o
          punto y coma como separador. Solo la columna «nombre» es obligatoria.
        </p>
        <a
          href="/api/clientes/plantilla"
          className="inline-block text-sm underline underline-offset-4"
        >
          Descargar plantilla
        </a>
        <Campo nombre="archivo" titulo="Archivo CSV" prefijo={prefijo} errores={errores}>
          {(a) => (
            <input
              {...a}
              key={seleccion}
              type="file"
              accept=".csv,text/csv"
              disabled={pendiente || sinConfirmacion}
              className={
                "block w-full rounded-lg border p-3 text-sm " +
                "file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1"
              }
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setAnalisis(null);
                setAceptarDuplicados(false);
                setErrores({});
                setFallo(null);
                setRequiereAnalisis(false);
              }}
            />
          )}
        </Campo>
        <Button type="submit" variant="secondary" disabled={pendiente || sinConfirmacion}>
          {pendiente && paso === "analisis" ? "Analizando…" : "Analizar archivo"}
        </Button>
      </section>
      {requiereAnalisis && (
        <p role="alert" className="rounded-lg border border-amber-600/40 bg-background p-4 text-sm">
          La cartera cambió desde el análisis. Vuelve a analizar el archivo y revisa el nuevo resumen antes de
          confirmar.
        </p>
      )}
      {analisis && (
        <section
          className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
          aria-labelledby={`${prefijo}-resumen`}
        >
          <h2 id={`${prefijo}-resumen`} className="text-lg font-semibold">
            2 · Revisar y confirmar
          </h2>
          <div role="status" className="grid grid-cols-3 gap-3 border-y py-4">
            {[
              ["Registros", analisis.resumen.registros],
              ["Filas válidas", analisis.resumen.validas],
              ["Filas con errores", analisis.resumen.errores.length],
            ].map(([titulo, valor]) => (
              <div key={titulo}>
                <p className="font-mono text-2xl tabular-nums">{valor}</p>
                <p className="mt-1 text-xs text-muted-foreground">{titulo}</p>
              </div>
            ))}
          </div>
          {analisis.resumen.errores.length > 0 && (
            <div role="alert" className="space-y-3">
              <h3 className="font-medium">Corrige el archivo antes de importar</h3>
              <p className="text-sm text-muted-foreground">
                El lote se importa completo o no se importa ninguna fila.
              </p>
              <ul className="max-h-72 space-y-2 overflow-auto rounded-lg border p-4 text-sm">
                {analisis.resumen.errores.map((e, i) => (
                  <li key={i}>
                    <strong>{e.fila === null ? "Archivo" : `Fila ${e.fila}`}:</strong> {e.mensajes.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analisis.resumen.registros === 0 && (
            <p role="alert" className="text-sm">
              El archivo no contiene clientes. Agrega registros antes de importar.
            </p>
          )}
          {analisis.resumen.muestra.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Vista previa · hasta 20 clientes</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fila</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Dirección</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analisis.resumen.muestra.map((m) => (
                    <TableRow key={m.fila}>
                      <TableCell>{m.fila}</TableCell>
                      <TableCell className="whitespace-normal">{m.nombre}</TableCell>
                      <TableCell className="whitespace-normal">{m.direccion ?? "Sin dirección"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {analisis.resumen.posiblesDuplicados.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium">
                Posibles duplicados ({analisis.resumen.posiblesDuplicados.length})
              </h3>
              <ul className="max-h-72 space-y-2 overflow-auto rounded-lg border p-4 text-sm">
                {analisis.resumen.posiblesDuplicados.map((d, i) => (
                  <li key={i}>
                    Fila {d.fila}, <strong>{d.nombre}</strong>:{" "}
                    {d.con === "archivo"
                      ? `coincide con la fila ${d.otraFila}`
                      : `coincide con «${d.nombreExistente}» en la cartera`}
                    .
                  </li>
                ))}
              </ul>
              <Campo
                nombre="duplicados"
                titulo="Confirmación de duplicados"
                prefijo={prefijo}
                errores={errores}
              >
                {(a) => (
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      {...a}
                      type="checkbox"
                      disabled={pendiente || requiereAnalisis || sinConfirmacion}
                      checked={aceptarDuplicados}
                      onChange={(e) => setAceptarDuplicados(e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    Revisé los posibles duplicados y acepto importar estas filas como clientes nuevos.
                  </label>
                )}
              </Campo>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Los clientes se crearán activos con los datos del archivo. La aceptación de privacidad se registra en cada ficha.
          </p>
          <Button
            type="button"
            onClick={confirmar}
            disabled={
              pendiente ||
              requiereAnalisis ||
              analisis.resumen.errores.length > 0 ||
              analisis.resumen.validas === 0 ||
              (analisis.resumen.posiblesDuplicados.length > 0 && !aceptarDuplicados)
            }
          >
            {pendiente && paso === "confirmacion"
              ? "Importando…"
              : sinConfirmacion
                ? "Reintentar confirmación"
                : "Confirmar importación"}
          </Button>
        </section>
      )}
      <Link href="/despacho/clientes" className={buttonVariants({ variant: "ghost" })}>
        Volver a clientes
      </Link>
    </form>
  );
}
