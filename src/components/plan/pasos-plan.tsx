import type { VistaPlan } from "@/consultas/plan";

const pasos = ["Generar", "Revisar y validar", "Seguir el día"] as const;

export function PasosPlan({ vista }: { vista: VistaPlan }) {
  const actual = vista.estado === "validado" ? 3 : vista.estado === "propuesto" ? 2 : 1;
  const indicacion = vista.estado === "sin_plan"
    ? vista.puedeGenerar ? "revisa la lista de abajo y presiona «Generar plan»." : "el despacho todavía no genera el plan de este día."
    : vista.estado === "validado"
      ? vista.puedeGenerar ? "sigue cada camión en «Cómo va el día». El avance lo marca el operador en su teléfono o tú con «Marcar»." : "sigue cada camión en «Cómo va el día»."
      : vista.tipo === "re_ruteo"
        ? vista.puedeGenerar ? "revisa el re-ruteo y valídalo al final; reemplaza al plan que estaba vigente." : "el despacho está revisando un re-ruteo."
        : vista.puedeGenerar ? "revisa las rutas. Si algo no te convence, mueve o pospone recolecciones. Cuando estén bien, confirma los requisitos al final y presiona «Validar»." : "el despacho está revisando el plan.";

  return <div className="space-y-3">
    <ol aria-label="Pasos del plan del día" className="grid min-w-0 gap-2 sm:grid-cols-3">
      {pasos.map((paso, indice) => <li key={paso} aria-current={indice + 1 === actual ? "step" : undefined}
        className={`min-w-0 rounded-lg border px-3 py-2 text-sm font-medium [overflow-wrap:anywhere] ${indice + 1 === actual ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground"}`}>
        {indice + 1}. {paso}
      </li>)}
    </ol>
    <p className="rounded-lg border bg-muted px-4 py-3 text-sm"><strong>Ahora:</strong> {indicacion}</p>
  </div>;
}
