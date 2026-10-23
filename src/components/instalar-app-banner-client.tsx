"use client";

/**
 * <BannerInstalar /> — convite discreto para instalar o app, no fim de /app
 * (23/10/2026). Só aparece quando há algo a fazer: Android/Chrome com o diálogo
 * de instalação disponível, ou iPhone/iPad (leva ao passo a passo em /app/conta).
 * Dispensável: o "X" grava no localStorage e o banner não volta neste aparelho.
 */
import Link from "next/link";
import { Download, X } from "lucide-react";
import {
  dispensarBannerInstalar,
  instalarApp,
  useBannerDispensado,
  useInstalacao,
} from "@/components/instalar-app-estado";

export function BannerInstalar() {
  const est = useInstalacao();
  const dispensado = useBannerDispensado();

  if (!est.carregado || dispensado !== false || est.instalado || !(est.podeInstalar || est.ios)) return null;

  return (
    <aside
      aria-label="Instalar o app"
      className="flex items-center gap-2 rounded-[14px] border border-line bg-card py-1.5 pr-1 pl-3.5"
    >
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
        <b className="font-semibold text-ink">Instale o app</b> na tela inicial do celular.
      </p>
      {est.podeInstalar ? (
        <button
          type="button"
          onClick={() => void instalarApp()}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-kraft bg-kraft px-3 text-sm font-semibold text-white hover:opacity-90"
        >
          <Download className="size-4" aria-hidden />
          Instalar
        </button>
      ) : (
        <Link
          href="/app/conta#instalar"
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          Como instalar
        </Link>
      )}
      <button
        type="button"
        onClick={dispensarBannerInstalar}
        aria-label="Dispensar aviso de instalação"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-3 hover:text-ink"
      >
        <X className="size-[18px]" aria-hidden />
      </button>
    </aside>
  );
}
