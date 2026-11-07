"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { cambiarMiClaveAccion } from "@/acciones/cuenta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Campo = "actual" | "nueva" | "confirmacion";

const CAMPOS: { campo: Campo; etiqueta: string; autocompletar: string; ayuda?: string }[] = [
  { campo: "actual", etiqueta: "Contraseña actual", autocompletar: "current-password" },
  { campo: "nueva", etiqueta: "Nueva contraseña", autocompletar: "new-password", ayuda: "Entre 10 y 128 caracteres. Una frase que recuerdes funciona bien." },
  { campo: "confirmacion", etiqueta: "Confirma la nueva", autocompletar: "new-password" },
];

/**
 * Cambia la contraseña propia (diseño del 2026-11-07, §2.2). Con onSubmit y no con `action`: así, si algo falla, lo
 * escrito no se borra. Si la contraseña era temporal, al terminar va al inicio del rol.
 */
export function FormularioClave({ correo, obligatorio }: { correo: string; obligatorio: boolean }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [listo, setListo] = useState(false);

  function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const datos = new FormData(formulario);
    const valor = (campo: Campo) => String(datos.get(campo) ?? "");
    iniciar(async () => {
      setErrores({});
      setListo(false);
      const r = await cambiarMiClaveAccion({ actual: valor("actual"), nueva: valor("nueva"), confirmacion: valor("confirmacion") });
      if (r.ok) {
        formulario.reset();
        if (r.valor.obligatorio) {
          router.replace("/");
          router.refresh();
          return;
        }
        setListo(true);
        return;
      }
      if (r.error === "no_autenticado") {
        router.replace("/entrar");
        return;
      }
      setErrores(r.error === "invalido" ? r.campos : { _: ["No se pudo cambiar la contraseña. Vuelve a intentarlo."] });
    });
  }

  const generales = errores._ ?? [];
  return (
    <form onSubmit={guardar} aria-label="Cambiar mi contraseña" className="flex flex-col gap-4">
      {/* Para que el gestor de contraseñas del navegador guarde la nueva con el correo correcto. */}
      <input type="email" name="usuario" autoComplete="username" value={correo} readOnly hidden />
      {CAMPOS.map(({ campo, etiqueta, autocompletar, ayuda }) => {
        const mensajes = errores[campo] ?? [];
        const ids = [ayuda && `${campo}-ayuda`, mensajes.length > 0 && `${campo}-error`].filter(Boolean).join(" ") || undefined;
        return (
          <div key={campo} className="flex flex-col gap-2">
            <Label htmlFor={campo}>{etiqueta}</Label>
            <Input
              id={campo}
              name={campo}
              type="password"
              autoComplete={autocompletar}
              required
              maxLength={128}
              aria-invalid={mensajes.length > 0 || undefined}
              aria-describedby={ids}
            />
            {ayuda && <p id={`${campo}-ayuda`} className="text-xs text-muted-foreground">{ayuda}</p>}
            {mensajes.length > 0 && <p id={`${campo}-error`} className="text-sm text-destructive">{mensajes.join(" ")}</p>}
          </div>
        );
      })}
      {generales.length > 0 && <p role="alert" className="text-sm text-destructive">{generales.join(" ")}</p>}
      {Object.keys(errores).some((c) => c !== "_") && (
        <p role="alert" className="sr-only">Revisa los campos marcados.</p>
      )}
      {listo && (
        <p role="status" className="text-sm">
          Listo. Tu contraseña cambió y cerramos tus otras sesiones.
        </p>
      )}
      <Button type="submit" disabled={pendiente}>
        {pendiente ? "Guardando…" : obligatorio ? "Guardar y continuar" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
