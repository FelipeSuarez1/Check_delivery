"use client";

/**
 * <InstalarApp /> — cartão "Instalar no celular" de /app/conta (23/10/2026).
 *  - Android/Chrome com o diálogo disponível → botão "Instalar";
 *  - iPhone/iPad → passo a passo (Compartilhar → Adicionar à Tela de Início);
 *  - já instalado → "Instalado ✓";
 *  - qualquer outro → instrução genérica do menu do navegador.
 * O estado vem de instalar-app-estado (um ouvinte global compartilhado com o banner).
 */
import { useState } from "react";
import { CircleCheck, Download, EllipsisVertical, Share, Smartphone, SquarePlus } from "lucide-react";
import { instalarApp, useInstalacao } from "@/components/instalar-app-estado";

function Passo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white tabular-nums">
        {n}
      </span>
      <span className="text-sm leading-6">{children}</span>
    </li>
  );
}

function IconeInline({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex size-6 items-center justify-center rounded-md border border-line bg-paper align-middle text-ink">
      {children}
    </span>
  );
}

export function InstalarApp() {
  const est = useInstalacao();
  const [recusou, setRecusou] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function aoInstalar() {
    if (ocupado) return;
    setOcupado(true);
    const r = await instalarApp();
    setOcupado(false);
    if (r === "recusado") setRecusou(true);
  }

  return (
    <section id="instalar" className="flex scroll-mt-4 flex-col gap-3 rounded-[14px] border border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-kraft-soft text-kraft-ink">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-base">Instalar no celular</h2>
          <p className="text-[13px] text-ink-2">O app fica na tela inicial, como qualquer outro.</p>
        </div>
      </div>

      {!est.carregado ? null : est.instalado ? (
        <p className="flex items-center gap-2 rounded-[10px] bg-ok-soft px-3 py-2.5 text-sm font-semibold text-ok">
          <CircleCheck className="size-5 shrink-0" aria-hidden />
          Instalado ✓
          <span className="font-normal text-ink-2">neste aparelho</span>
        </p>
      ) : est.podeInstalar ? (
        <>
          <button
            type="button"
            onClick={aoInstalar}
            disabled={ocupado}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-kraft bg-kraft px-4 font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            <Download className="size-[18px]" aria-hidden />
            Instalar
          </button>
          {recusou && (
            <p className="text-[13px] text-ink-2">
              Tudo bem — quando quiser, é só tocar em Instalar de novo (ou usar o menu do navegador).
            </p>
          )}
        </>
      ) : est.ios ? (
        <>
          <ol className="flex flex-col gap-2.5">
            <Passo n={1}>
              Toque em <b className="font-semibold">Compartilhar</b>
              <IconeInline>
                <Share className="size-4" aria-hidden />
              </IconeInline>
              na barra do Safari.
            </Passo>
            <Passo n={2}>
              Role a lista e toque em <b className="font-semibold">Adicionar à Tela de Início</b>
              <IconeInline>
                <SquarePlus className="size-4" aria-hidden />
              </IconeInline>
              .
            </Passo>
            <Passo n={3}>
              Confirme em <b className="font-semibold">Adicionar</b>. O ícone Encomendas aparece na tela do celular.
            </Passo>
          </ol>
          {!est.iosSafari && (
            <p className="rounded-[10px] bg-kraft-soft px-3 py-2 text-[13px] text-kraft-ink">
              No iPhone a instalação funciona melhor pelo <b className="font-semibold">Safari</b>. Se a opção não
              aparecer, abra este endereço no Safari.
            </p>
          )}
        </>
      ) : (
        <ol className="flex flex-col gap-2.5">
          <Passo n={1}>
            Abra o menu do navegador
            <IconeInline>
              <EllipsisVertical className="size-4" aria-hidden />
            </IconeInline>
            (os três pontinhos).
          </Passo>
          <Passo n={2}>
            Toque em <b className="font-semibold">Instalar app</b> ou <b className="font-semibold">Adicionar à tela inicial</b>.
          </Passo>
        </ol>
      )}
    </section>
  );
}
