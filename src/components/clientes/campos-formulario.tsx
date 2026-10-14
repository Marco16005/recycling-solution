"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Label } from "@/components/ui/label";

export type Errores = Record<string, string[]>;
export const CLASE_SELECT =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-base outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 md:text-sm";

type AtributosCampo = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
  "data-campo": string;
};

export function Campo({
  nombre,
  titulo,
  prefijo,
  errores,
  children,
}: {
  nombre: string;
  titulo: string;
  prefijo: string;
  errores: Errores;
  children: (atributos: AtributosCampo) => ReactNode;
}) {
  const id = `${prefijo}-${nombre}`;
  const grupo = ["ventanas", "documentos", "tiposUnidadAdmitidos"].includes(nombre);
  const mensajes = grupo
    ? Object.entries(errores)
        .filter(([campo]) => campo === nombre || campo.startsWith(`${nombre}.`))
        .flatMap(([, lista]) => lista)
    : errores[nombre];
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{titulo}</Label>
      {children({
        id,
        "aria-invalid": Boolean(mensajes?.length),
        "aria-describedby": mensajes?.length ? `${id}-error` : undefined,
        "data-campo": nombre,
      })}
      {mensajes?.length ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {mensajes.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function ResumenErrores({ errores }: { errores: Errores }) {
  const resumen = useRef<HTMLDivElement>(null);
  const hayErrores = Object.keys(errores).length > 0;
  useEffect(() => {
    if (!hayErrores) return;
    const formulario = resumen.current?.closest("form");
    const campo =
      formulario?.querySelector<HTMLElement>(
        'input[aria-invalid="true"]:not(:disabled), ' +
          'select[aria-invalid="true"]:not(:disabled), textarea[aria-invalid="true"]:not(:disabled)',
      ) ?? formulario?.querySelector<HTMLElement>('[aria-invalid="true"][tabindex]');
    (campo ?? resumen.current)?.focus();
  }, [errores, hayErrores]);
  if (!hayErrores) return null;
  return (
    <div
      ref={resumen}
      tabIndex={-1}
      role="alert"
      className="rounded-lg border border-destructive/40 bg-background p-4 text-sm"
    >
      <p className="font-medium">Revisa los datos antes de continuar.</p>
      <ul className="mt-2 list-inside list-disc space-y-1">
        {Object.entries(errores).flatMap(([campo, mensajes]) =>
          mensajes.map((mensaje, i) => <li key={`${campo}-${i}`}>{mensaje}</li>),
        )}
      </ul>
    </div>
  );
}
