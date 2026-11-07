import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Lleva a la pantalla donde cada usuario cambia su propia contraseña. Va junto a Salir en cada encabezado. */
export function EnlaceCuenta() {
  return (
    <Link href="/cuenta/contrasena" className={buttonVariants({ variant: "ghost", size: "sm" })}>
      Mi contraseña
    </Link>
  );
}
