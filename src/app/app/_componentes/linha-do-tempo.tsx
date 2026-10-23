/**
 * <LinhaDoTempo passos /> — card "Linha do tempo" da encomenda (mockup
 * MoradorCodigo, 23/10/2026). Marcador cheio verde = aconteceu; vazado kraft =
 * em andamento (aguardando); vazado vermelho = parada há 3 dias ou mais;
 * cinza = cancelada. Os passos vêm prontos de `montarLinhaDoTempo` (lib/morador).
 */
import type { PassoTempo } from "@/lib/morador";
import { cn } from "@/lib/utils";

const MARCADOR: Record<PassoTempo["marcador"], string> = {
  ok: "bg-ok",
  espera: "border-2 border-kraft",
  alerta: "border-2 border-warn",
  neutro: "bg-ink-3",
};

export function LinhaDoTempo({ passos }: { passos: PassoTempo[] }) {
  return (
    <section aria-label="Linha do tempo" className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-card p-4">
      <span className="eyebrow">Linha do tempo</span>
      <ol className="flex flex-col gap-2.5">
        {passos.map((p) => {
          const emAndamento = p.marcador === "espera" || p.marcador === "alerta";
          return (
            <li key={p.chave} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className={cn("mt-1.5 inline-flex size-2.5 shrink-0 rounded-full", MARCADOR[p.marcador])}
              />
              <div className="min-w-0">
                <b className={cn("font-semibold", emAndamento && "text-ink-2", p.marcador === "alerta" && "text-warn")}>
                  {p.titulo}
                </b>
                {p.linhas.map((l, i) => (
                  <div
                    key={i}
                    className={cn("text-[13px] tabular-nums", emAndamento ? "text-ink-3" : "text-ink-2", p.marcador === "alerta" && "text-warn")}
                  >
                    {l}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
