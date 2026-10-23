"use client";

/**
 * <FotosAmpliaveis fotos codigo /> — miniatura de 72 px da encomenda; o toque
 * abre a(s) foto(s) em tela cheia num diálogo simples (23/10/2026). Várias fotos:
 * a miniatura mostra "+N" e o diálogo empilha todas. Sem foto (retenção de 90
 * dias já apagou, ou nunca houve): só o placeholder, sem botão.
 * `fotos` = EncomendaResumo.fotos (só as que ainda existem no disco). As imagens
 * vêm de /fotos/<id>, que reconfere a sessão e o apto (404 para outro apto).
 */
import { FotoEncomenda } from "@/components/encomenda/foto-encomenda";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function FotosAmpliaveis({ fotos, codigo }: { fotos: { id: number }[]; codigo: string }) {
  if (fotos.length === 0) {
    return <FotoEncomenda fotoId={null} alt={`Sem foto da encomenda ${codigo}`} size={72} />;
  }
  const extras = fotos.length - 1;
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Ampliar ${fotos.length > 1 ? `as ${fotos.length} fotos` : "a foto"} da encomenda ${codigo}`}
            className="relative shrink-0 cursor-zoom-in rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-kraft"
          />
        }
      >
        <FotoEncomenda fotoId={fotos[0].id} alt={`Foto da encomenda ${codigo}`} size={72} />
        {extras > 0 && (
          <span className="absolute right-1 bottom-1 rounded-full bg-ink/80 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white tabular-nums">
            +{extras}
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] gap-2 overflow-hidden p-3 sm:max-w-[420px]">
        <DialogTitle className="pr-12 leading-[44px]">Encomenda {codigo}</DialogTitle>
        <div className="flex max-h-[calc(92dvh-92px)] flex-col gap-2 overflow-y-auto">
          {fotos.map((f, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- rota autenticada própria; o otimizador do Next não carrega o cookie
            <img
              key={f.id}
              src={`/fotos/${f.id}`}
              alt={`Foto ${i + 1} da encomenda ${codigo}`}
              decoding="async"
              className="w-full rounded-lg bg-muted object-contain"
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
