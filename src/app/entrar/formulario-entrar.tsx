"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/seguridad/auth-cliente";

export function FormularioEntrar() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

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
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pendiente}>
        {pendiente ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
