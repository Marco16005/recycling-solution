"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/seguridad/auth-cliente";
import { borrarDatosDelOperador } from "./registrar-sw-operador";

/** Cierra la sesión, borra lo que /operador guardó en el teléfono y lleva a /entrar. */
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
          await borrarDatosDelOperador();
          router.replace("/entrar");
          router.refresh();
        })
      }
    >
      Salir
    </Button>
  );
}
