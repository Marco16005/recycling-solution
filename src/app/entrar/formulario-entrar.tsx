"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/seguridad/auth-cliente";
import { borrarDatosDelOperador } from "@/components/sesion/registrar-sw-operador";
import { completarSalidaPendiente } from "@/components/sesion/salida-pendiente";

export function FormularioEntrar() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [salidaPendiente, setSalidaPendiente] = useState(false);
  const [listo, setListo] = useState(false);

  // Si el último «Salir» no llegó al servidor, se cierra ahora que hay red (Plan de seguridad, hallazgo 4). Entrar espera
  // a que termine: un cierre tardío revocaría la sesión nueva.
  useEffect(() => {
    void completarSalidaPendiente().then((sigue) => {
      setSalidaPendiente(sigue);
      setListo(true);
    });
  }, []);

  function entrar(datos: FormData) {
    iniciar(async () => {
      setError(null);
      const { error } = await authClient.signIn.email({
        email: String(datos.get("correo") ?? ""),
        password: String(datos.get("clave") ?? ""),
      });
      if (error) {
        setError("No se pudo entrar. Revisa tu correo y contraseña, o pide ayuda al administrador.");
        return;
      }
      // Las pantallas de /operador que otro usuario dejó guardadas en este teléfono no se conservan.
      await borrarDatosDelOperador({ soloCache: true });
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form action={entrar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="correo">Correo</Label>
        <Input id="correo" name="correo" type="email" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="clave">Contraseña</Label>
        <Input id="clave" name="clave" type="password" autoComplete="current-password" required />
      </div>
      {salidaPendiente && (
        <p role="alert" className="text-sm text-destructive">
          La sesión anterior no se pudo cerrar en el servidor. Los datos ya se borraron de este teléfono; cuando tengas
          señal, recarga esta página para terminar de cerrarla.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pendiente || !listo}>
        {pendiente ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
