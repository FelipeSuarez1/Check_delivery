"use client";

/**
 * <GaleriaFotos fotos codigo vazio? className? />  (23/10/2026)
 * Foto GRANDE da encomenda (detalhe da portaria): a principal em ~360 px de
 * altura, miniaturas para trocar (até 3) e toque na foto para ampliar em tela
 * cheia. Fotos vêm de `/fotos/<id>` (autenticada).
 *  - fotos: EncomendaResumo.fotos ({ id, ordem }[]) - só as que ainda existem no disco
 *  - codigo: para os textos alternativos
 *  - vazio: mensagem quando não há foto (ex. já apagada pela retenção de 90 dias)
 */
import { useState } from "react";
import { ImageOff, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function GaleriaFotos({
  fotos,
  codigo,
  vazio = "Sem foto",
  className,
}: {
  fotos: { id: number; ordem: number }[];
  codigo: string;
  vazio?: string;
  className?: string;
}) {
  const [indice, setIndice] = useState(0);
  const [ampliada, setAmpliada] = useState(false);
  const [falhas, setFalhas] = useState<number[]>([]);

  const atual = fotos[Math.min(indice, Math.max(0, fotos.length - 1))];
  const falhou = atual ? falhas.includes(atual.id) : false;

  if (!atual || falhou) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-[10px] bg-[repeating-linear-gradient(135deg,#EFEAE0_0_10px,#E7E1D5_10px_20px)] text-ink-3 md:h-[360px]">
          <ImageOff className="size-9" aria-hidden />
          <span className="px-6 text-center text-[15px] text-ink-2">{vazio}</span>
        </div>
        {fotos.length > 1 && (
          <Miniaturas fotos={fotos} indice={indice} codigo={codigo} onEscolher={setIndice} />
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <button
        type="button"
        onClick={() => setAmpliada(true)}
        aria-label={`Ampliar a foto ${indice + 1} da encomenda ${codigo}`}
        className="group relative flex h-64 w-full items-center justify-center overflow-hidden rounded-[10px] border border-line bg-[#EFEAE0] md:h-[360px]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada própria; o otimizador do Next não carrega o cookie */}
        <img
          src={`/fotos/${atual.id}`}
          alt={`Foto ${indice + 1} da encomenda ${codigo}`}
          onError={() => setFalhas((f) => [...f, atual.id])}
          className="size-full object-contain"
        />
        <span className="absolute bottom-2 right-2 flex h-9 items-center gap-1.5 rounded-full bg-ink/80 px-3 text-xs font-semibold text-white">
          <Maximize2 className="size-3.5" aria-hidden /> Ampliar
        </span>
      </button>

      {fotos.length > 1 && <Miniaturas fotos={fotos} indice={indice} codigo={codigo} onEscolher={setIndice} />}

      <Dialog open={ampliada} onOpenChange={setAmpliada}>
        <DialogContent className="max-w-[min(96vw,980px)] gap-2 p-2 sm:max-w-[min(96vw,980px)]">
          <DialogTitle className="sr-only">Foto da encomenda {codigo}</DialogTitle>
          <DialogDescription className="sr-only">Foto ampliada. Toque fora ou em Fechar para voltar.</DialogDescription>
          {/* eslint-disable-next-line @next/next/no-img-element -- idem acima */}
          <img
            src={`/fotos/${atual.id}`}
            alt={`Foto ${indice + 1} ampliada da encomenda ${codigo}`}
            className="max-h-[86dvh] w-full rounded-lg bg-[#EFEAE0] object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Miniaturas({
  fotos,
  indice,
  codigo,
  onEscolher,
}: {
  fotos: { id: number; ordem: number }[];
  indice: number;
  codigo: string;
  onEscolher: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {fotos.map((f, i) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onEscolher(i)}
          aria-label={`Ver foto ${i + 1} da encomenda ${codigo}`}
          aria-current={i === indice}
          className={cn(
            "h-[72px] w-[92px] overflow-hidden rounded-[10px] bg-[#EFEAE0]",
            i === indice ? "border-2 border-kraft" : "border border-line"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- idem acima */}
          <img src={`/fotos/${f.id}`} alt="" loading="lazy" className="size-full object-cover" />
        </button>
      ))}
      <span className="text-xs text-ink-3">
        {fotos.length} fotos · toque para trocar
      </span>
    </div>
  );
}
