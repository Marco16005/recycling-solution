"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/seguridad/auth-cliente";
import { borrarDatosDelOperador } from "./registrar-sw-operador";
import { marcarSalidaPendiente } from "./salida-pendiente";

/**
 * Cierra la sesión, borra lo que /operador guardó en el teléfono y lleva a /entrar. Si el servidor no recibió el cierre
 * (sin señal), se sale de todos modos y /entrar lo reintenta al cargar (Plan de seguridad, hallazgo 4).
 */
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
          let cerrada = false;
          try {
            cerrada = !(await authClient.signOut()).error;
          } catch {
            // Sin red: el servidor no se enteró.
          } finally {
            // Aunque falle la red: la ruta guardada en el teléfono no debe quedar para el siguiente usuario.
            await borrarDatosDelOperador();
          }
          if (!cerrada) marcarSalidaPendiente();
          // Siempre a una pantalla sin datos personales.
          router.replace("/entrar");
          router.refresh();
        })
      }
    >
      Salir
    </Button>
  );
}
