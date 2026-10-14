"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/seguridad/auth-cliente";

/** Cierra la sesión y lleva a /entrar. */
export function BotonSalir() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pendiente}
      onClick={() =>
        iniciar(async () => {
          await authClient.signOut();
          router.replace("/entrar");
          router.refresh();
        })
      }
    >
      Salir
    </Button>
  );
}
