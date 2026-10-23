/**
 * <StampStatus status diasParada? className? />  (22/10/2026)
 * Carimbo (borda 1,5 px, caixa alta, 26 px de altura):
 *  - aguardando, diasParada < PARADA_DIAS -> "Aguardando" (kraft)
 *  - aguardando, diasParada >= PARADA_DIAS -> "N dias" (warn, vermelho)
 *  - entregue -> "Entregue" (ok)   - cancelada -> "Cancelada" (neutro)
 * Props: status: 'aguardando'|'entregue'|'cancelada'; diasParada: number (de EncomendaResumo.diasParada).
 */
import { Ban, Check, TriangleAlert } from "lucide-react";
import { PARADA_DIAS, type StatusEncomenda } from "@/lib/encomenda-constantes";
import { cn } from "@/lib/utils";

const TONS = {
  espera: "bg-kraft-soft text-kraft-ink",
  atraso: "bg-warn-soft text-warn",
  pronto: "bg-ok-soft text-ok",
  neutro: "bg-paper text-ink-2",
} as const;

export function StampStatus({
  status,
  diasParada = 0,
  className,
}: {
  status: StatusEncomenda;
  diasParada?: number;
  className?: string;
}) {
  let tom: keyof typeof TONS = "espera";
  let rotulo = "Aguardando";
  let Icone: typeof Check | null = null;

  if (status === "entregue") {
    tom = "pronto";
    rotulo = "Entregue";
    Icone = Check;
  } else if (status === "cancelada") {
    tom = "neutro";
    rotulo = "Cancelada";
    Icone = Ban;
  } else if (diasParada >= PARADA_DIAS) {
    tom = "atraso";
    rotulo = diasParada === 1 ? "1 dia" : `${diasParada} dias`;
    Icone = TriangleAlert;
  }

  return (
    <span
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border-[1.5px] border-current px-2.5 text-xs font-bold uppercase tracking-[.08em]",
        TONS[tom],
        className
      )}
    >
      {Icone && <Icone className="size-3" aria-hidden="true" />}
      {rotulo}
    </span>
  );
}
