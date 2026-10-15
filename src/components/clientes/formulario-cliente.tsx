"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { guardarClienteAccion } from "@/acciones/clientes";
import type { FichaCliente } from "@/consultas/clientes";
import type { TipoDocumento } from "@/dominio/flota/tipos";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { aEntrada, clienteNuevo } from "@/dominio/clientes/formulario";
import type { ClienteEntrada } from "@/dominio/clientes/esquemas";
import {
  DIAS_SEMANA,
  ETIQUETA_ESTADO_DOCUMENTO,
  ETIQUETA_RESIDUO,
  ETIQUETA_UNIDAD,
} from "@/dominio/clientes/etiquetas";
import {
  ESTADOS_DOCUMENTO,
  TIPOS_RESIDUO,
  TIPOS_UNIDAD,
  type EstadoDocumento,
  type TipoResiduo,
} from "@/dominio/clientes/tipos";
import { Campo, CLASE_SELECT, ResumenErrores, type Errores } from "./campos-formulario";
import { ResultadoFallido, type Fallo } from "./resultado-fallido";

const SelectorUbicacion = dynamic(() => import("./selector-ubicacion").then((m) => m.SelectorUbicacion), {
  ssr: false,
  loading: () => (
    <p className="flex h-72 items-center justify-center rounded-lg border text-sm text-muted-foreground">
      Cargando mapa…
    </p>
  ),
});
const texto = (valor: string) => (valor === "" ? null : valor);
const numero = (valor: string) => (valor === "" ? null : Number(valor));

export function FormularioCliente({ ficha, estiloMapaUrl, catalogoDocumentos = ficha?.catalogoDocumentos ?? [] }: {
  ficha?: FichaCliente;
  estiloMapaUrl: string;
  catalogoDocumentos?: TipoDocumento[];
}) {
  const router = useRouter();
  const prefijo = useId();
  const [datos, setDatos] = useState<ClienteEntrada>(() =>
    ficha ? aEntrada(ficha.cliente) : clienteNuevo(),
  );
  const [version, setVersion] = useState<number | null>(ficha?.cliente.version ?? null);
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [conflicto, setConflicto] = useState(false);
  const [respaldo, setRespaldo] = useState<ClienteEntrada | null>(null);
  const [pendiente, iniciar] = useTransition();
  const editable = ficha?.puedeEditar ?? true;

  function cambiar<K extends keyof ClienteEntrada>(campo: K, valor: ClienteEntrada[K]) {
    setDatos((actual) => ({ ...actual, [campo]: valor }));
    setMensaje("");
  }

  function cargarActual() {
    if (!ficha) return;
    setRespaldo(datos);
    setDatos(aEntrada(ficha.cliente));
    setVersion(ficha.cliente.version);
    setConflicto(false);
    setErrores({});
    setMensaje("Ficha actual cargada. Tu borrador anterior sigue disponible para recuperarlo.");
  }

  function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!editable || pendiente || conflicto) return;
    setErrores({});
    setFallo(null);
    setMensaje("");
    iniciar(async () => {
      let resultado;
      try {
        resultado = await guardarClienteAccion(ficha?.cliente.id ?? null, version, datos);
      } catch {
        setErrores({
          _: [
            "No se pudo confirmar el guardado. Conservamos tus datos; revisa la conexión antes de reintentar.",
          ],
        });
        return;
      }
      if (!resultado.ok) {
        if (resultado.error === "invalido") setErrores(resultado.campos);
        else if (resultado.error === "conflicto") setConflicto(true);
        else setFallo(resultado);
        return;
      }
      setVersion(resultado.valor.version);
      setMensaje("Cliente guardado.");
      if (!ficha) {
        setDatos(clienteNuevo());
        setVersion(null);
        setMensaje("");
        router.replace(`/despacho/clientes/${resultado.valor.id}`);
      }
      router.refresh();
    });
  }

  const campo = (nombre: keyof ClienteEntrada, titulo: string, tipo = "text") => (
    <Campo nombre={nombre} titulo={titulo} prefijo={prefijo} errores={errores}>
      {(atributos) => (
        <Input
          {...atributos}
          type={tipo}
          value={String(datos[nombre] ?? "")}
          onChange={(e) => {
            if (tipo === "number")
              cambiar(
                nombre,
                nombre === "tiempoServicioMin" ? Number(e.target.value) : numero(e.target.value),
              );
            else cambiar(nombre, nombre === "nombre" ? e.target.value : texto(e.target.value));
          }}
          step={tipo === "number" ? "any" : undefined}
        />
      )}
    </Campo>
  );

  return (
    <form onSubmit={guardar} noValidate className="space-y-6" aria-label="Ficha del cliente">
      {fallo && <ResultadoFallido resultado={fallo} />}
      <ResumenErrores errores={errores} />
      {mensaje && (
        <p role="status" className="rounded-lg border bg-background p-4 text-sm">
          {mensaje}
        </p>
      )}
      {conflicto && (
        <section
          role="alert"
          className="space-y-3 rounded-lg border border-amber-600/40 bg-background p-4 text-sm"
        >
          <h2 className="font-semibold">Otro despachador modificó esta ficha</h2>
          <p>Tu captura sigue en el formulario. Consulta la ficha actual antes de volver a guardar.</p>
          <Button
            type="button"
            variant="outline"
            disabled={pendiente}
            onClick={() => iniciar(() => router.refresh())}
          >
            Recargar ficha sin perder mi captura
          </Button>
          {ficha && ficha.cliente.version !== version && (
            <div className="space-y-2">
              <p>
                Ya recibimos la ficha actual. Puedes cargarla para revisarla; conservaremos tu captura como
                borrador.
              </p>
              <Button type="button" variant="secondary" onClick={cargarActual}>
                Cargar ficha actual y conservar borrador
              </Button>
            </div>
          )}
        </section>
      )}
      {respaldo && editable && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <p>Hay una copia de tu captura anterior.</p>
          <Button
            type="button"
            variant="outline"
            disabled={pendiente}
            onClick={() => {
              setDatos(respaldo);
              setRespaldo(null);
              setMensaje("Borrador recuperado. Revisa los cambios antes de guardar sobre la ficha actual.");
            }}
          >
            Recuperar mi borrador
          </Button>
        </div>
      )}
      {!editable && (
        <p className="rounded-lg border bg-background p-4 text-sm">Consulta de gerencia · Solo lectura</p>
      )}
      <fieldset disabled={!editable || pendiente} className="space-y-6">
        <section
          className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
          aria-labelledby={`${prefijo}-generales`}
        >
          <h2 id={`${prefijo}-generales`} className="text-lg font-semibold">
            01 · Datos generales
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">{campo("nombre", "Nombre del cliente")}</div>
            {campo("contactoNombre", "Nombre del contacto")}
            {campo("contactoTelefono", "Teléfono", "tel")}
          </div>
          <Campo nombre="activo" titulo="Estado del cliente" prefijo={prefijo} errores={errores}>
            {(a) => (
              <label className="flex items-center gap-2 text-sm">
                <input
                  {...a}
                  type="checkbox"
                  checked={datos.activo}
                  onChange={(e) => cambiar("activo", e.target.checked)}
                  className="size-4 accent-primary"
                />
                Cliente activo
              </label>
            )}
          </Campo>
        </section>
        <section
          className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
          aria-labelledby={`${prefijo}-ubicacion`}
        >
          <h2 id={`${prefijo}-ubicacion`} className="text-lg font-semibold">
            02 · Ubicación y acceso
          </h2>
          {campo("direccion", "Dirección")}
          <div className="grid gap-5 sm:grid-cols-2">
            {campo("lat", "Latitud", "number")}
            {campo("lng", "Longitud", "number")}
          </div>
          <p className="text-sm text-muted-foreground">
            {editable
              ? "Captura las coordenadas o coloca el punto en el mapa. Latitud y longitud se guardan juntas."
              : "Ubicación registrada del cliente."}
          </p>
          <SelectorUbicacion
            lat={datos.lat}
            lng={datos.lng}
            estiloMapaUrl={estiloMapaUrl}
            soloLectura={!editable || pendiente}
            alCambiar={(lat, lng) => {
              setDatos((d) => ({ ...d, lat, lng }));
              setMensaje("");
            }}
          />
          <Campo nombre="notasAcceso" titulo="Notas de acceso" prefijo={prefijo} errores={errores}>
            {(a) => (
              <Textarea
                {...a}
                value={datos.notasAcceso ?? ""}
                onChange={(e) => cambiar("notasAcceso", texto(e.target.value))}
              />
            )}
          </Campo>
        </section>
        <section
          className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
          aria-labelledby={`${prefijo}-servicio`}
        >
          <h2 id={`${prefijo}-servicio`} className="text-lg font-semibold">
            03 · Recolección
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Campo nombre="tipoResiduo" titulo="Tipo de residuo" prefijo={prefijo} errores={errores}>
              {(a) => (
                <select
                  {...a}
                  className={CLASE_SELECT}
                  value={datos.tipoResiduo ?? ""}
                  onChange={(e) =>
                    cambiar("tipoResiduo", e.target.value ? (e.target.value as TipoResiduo) : null)
                  }
                >
                  <option value="">Sin definir</option>
                  {TIPOS_RESIDUO.map((t) => (
                    <option key={t} value={t}>
                      {ETIQUETA_RESIDUO[t]}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
            {campo("material", "Material")}
            {campo("tiempoServicioMin", "Tiempo de servicio (minutos)", "number")}
            {campo("cargaEstimadaKg", "Carga estimada (kg)", "number")}
          </div>
          <Campo
            nombre="tiposUnidadAdmitidos"
            titulo="Tipos de unidad admitidos"
            prefijo={prefijo}
            errores={errores}
          >
            {(a) => (
              <div
                {...a}
                role="group"
                tabIndex={-1}
                aria-label="Tipos de unidad admitidos"
                className="flex flex-wrap gap-4"
              >
                {TIPOS_UNIDAD.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={datos.tiposUnidadAdmitidos.includes(t)}
                      onChange={(e) =>
                        cambiar(
                          "tiposUnidadAdmitidos",
                          e.target.checked
                            ? [...datos.tiposUnidadAdmitidos, t]
                            : datos.tiposUnidadAdmitidos.filter((u) => u !== t),
                        )
                      }
                    />
                    {ETIQUETA_UNIDAD[t]}
                  </label>
                ))}
              </div>
            )}
          </Campo>
        </section>
        <section
          className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
          aria-labelledby={`${prefijo}-ventanas`}
        >
          <h2 id={`${prefijo}-ventanas`} className="text-lg font-semibold">
            04 · Ventanas horarias
          </h2>
          <p className="text-sm text-muted-foreground">
            Horarios de recepción por día. Una ventana debe terminar el mismo día y no traslaparse con otra.
          </p>
          <Campo nombre="ventanas" titulo="Horarios de recepción" prefijo={prefijo} errores={errores}>
            {(a) => (
              <div {...a} role="group" aria-label="Horarios de recepción" tabIndex={-1} className="space-y-4">
                {datos.ventanas.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sin ventanas registradas.</p>
                )}
                {datos.ventanas.map((v, i) => (
                  <div
                    key={i}
                    className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <Campo
                      nombre={`ventanas.${i}.diaSemana`}
                      titulo={`Día · ventana ${i + 1}`}
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <select
                          {...b}
                          className={CLASE_SELECT}
                          value={v.diaSemana}
                          onChange={(e) =>
                            cambiar(
                              "ventanas",
                              datos.ventanas.map((w, j) =>
                                j === i ? { ...w, diaSemana: Number(e.target.value) } : w,
                              ),
                            )
                          }
                        >
                          {DIAS_SEMANA.map((dia, n) => (
                            <option key={dia} value={n}>
                              {dia}
                            </option>
                          ))}
                        </select>
                      )}
                    </Campo>
                    <Campo
                      nombre={`ventanas.${i}.horaInicio`}
                      titulo="Hora de inicio"
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <Input
                          {...b}
                          type="time"
                          value={v.horaInicio}
                          onChange={(e) =>
                            cambiar(
                              "ventanas",
                              datos.ventanas.map((w, j) =>
                                j === i ? { ...w, horaInicio: e.target.value } : w,
                              ),
                            )
                          }
                        />
                      )}
                    </Campo>
                    <Campo
                      nombre={`ventanas.${i}.horaFin`}
                      titulo="Hora de fin"
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <Input
                          {...b}
                          type="time"
                          value={v.horaFin}
                          onChange={(e) =>
                            cambiar(
                              "ventanas",
                              datos.ventanas.map((w, j) => (j === i ? { ...w, horaFin: e.target.value } : w)),
                            )
                          }
                        />
                      )}
                    </Campo>
                    {editable && (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={`Quitar ventana ${i + 1}`}
                        onClick={() =>
                          cambiar(
                            "ventanas",
                            datos.ventanas.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Quitar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Campo>
          {editable && (
            <Button
              type="button"
              variant="outline"
              disabled={datos.ventanas.length >= 21}
              onClick={() =>
                cambiar("ventanas", [
                  ...datos.ventanas,
                  { diaSemana: 1, horaInicio: "08:00", horaFin: "16:00" },
                ])
              }
            >
              Agregar ventana
            </Button>
          )}
        </section>
        <section
          className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
          aria-labelledby={`${prefijo}-documentos`}
        >
          <h2 id={`${prefijo}-documentos`} className="text-lg font-semibold">
            05 · Documentos
          </h2>
          <Campo nombre="documentos" titulo="Documentos del cliente" prefijo={prefijo} errores={errores}>
            {(a) => (
              <div
                {...a}
                role="group"
                aria-label="Documentos del cliente"
                tabIndex={-1}
                className="space-y-4"
              >
                {datos.documentos.length === 0 && (
                  <p className="text-sm text-muted-foreground">Sin documentos registrados.</p>
                )}
                {datos.documentos.map((d, i) => (
                  <div key={i} className="grid items-end gap-4 rounded-lg border p-4 sm:grid-cols-2">
                    <Campo
                      nombre={`documentos.${i}.tipoDocumentoId`}
                      titulo={`Tipo (catálogo) · documento ${i + 1}`}
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <select
                          {...b} className={CLASE_SELECT} value={d.tipoDocumentoId ?? ""}
                          onChange={(e) => {
                            const tipo = catalogoDocumentos.find((t) => t.id === e.target.value);
                            cambiar("documentos", datos.documentos.map((w, j) => j === i ? {
                              ...w, tipoDocumentoId: tipo?.id ?? null, nombre: tipo?.nombre ?? w.nombre,
                            } : w));
                          }}
                        >
                          <option value="">Nombre libre</option>
                          {catalogoDocumentos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                        </select>
                      )}
                    </Campo>
                    <Campo
                      nombre={`documentos.${i}.nombre`}
                      titulo={`Nombre · documento ${i + 1}`}
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <Input
                          {...b}
                          value={d.nombre}
                          readOnly={d.tipoDocumentoId != null}
                          onChange={(e) =>
                            cambiar(
                              "documentos",
                              datos.documentos.map((w, j) =>
                                j === i ? { ...w, nombre: e.target.value } : w,
                              ),
                            )
                          }
                        />
                      )}
                    </Campo>
                    <Campo
                      nombre={`documentos.${i}.estado`}
                      titulo="Estado registrado"
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <select
                          {...b}
                          className={CLASE_SELECT}
                          value={d.estado}
                          onChange={(e) =>
                            cambiar(
                              "documentos",
                              datos.documentos.map((w, j) =>
                                j === i ? { ...w, estado: e.target.value as EstadoDocumento } : w,
                              ),
                            )
                          }
                        >
                          {ESTADOS_DOCUMENTO.map((s) => (
                            <option key={s} value={s}>
                              {ETIQUETA_ESTADO_DOCUMENTO[s]}
                            </option>
                          ))}
                        </select>
                      )}
                    </Campo>
                    <Campo
                      nombre={`documentos.${i}.venceEl`}
                      titulo="Fecha de vencimiento (opcional)"
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <Input
                          {...b}
                          type="date"
                          value={d.venceEl ?? ""}
                          onChange={(e) =>
                            cambiar(
                              "documentos",
                              datos.documentos.map((w, j) =>
                                j === i ? { ...w, venceEl: texto(e.target.value) } : w,
                              ),
                            )
                          }
                        />
                      )}
                    </Campo>
                    <Campo
                      nombre={`documentos.${i}.obligatorio`}
                      titulo="Requisito para recolección"
                      prefijo={prefijo}
                      errores={errores}
                    >
                      {(b) => (
                        <label className="flex h-9 items-center gap-2 text-sm">
                          <input
                            {...b}
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={d.obligatorio}
                            onChange={(e) =>
                              cambiar(
                                "documentos",
                                datos.documentos.map((w, j) =>
                                  j === i ? { ...w, obligatorio: e.target.checked } : w,
                                ),
                              )
                            }
                          />
                          Obligatorio
                        </label>
                      )}
                    </Campo>
                    {editable && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="justify-self-start"
                        aria-label={`Quitar documento ${i + 1}`}
                        onClick={() =>
                          cambiar(
                            "documentos",
                            datos.documentos.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Quitar documento
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Campo>
          {editable && (
            <Button
              type="button"
              variant="outline"
              disabled={datos.documentos.length >= 30}
              onClick={() =>
                cambiar("documentos", [
                  ...datos.documentos,
                  { tipoDocumentoId: null, nombre: "", obligatorio: true, estado: "pendiente", venceEl: null },
                ])
              }
            >
              Agregar documento
            </Button>
          )}
        </section>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <Link href="/despacho/clientes" className={buttonVariants({ variant: "outline" })}>
          Volver a clientes
        </Link>
        {editable && (
          <Button type="submit" disabled={pendiente || conflicto}>
            {pendiente ? "Guardando…" : "Guardar cliente"}
          </Button>
        )}
      </div>
    </form>
  );
}
