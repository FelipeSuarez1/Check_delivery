"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Info, MessageCircle, Plus, Printer } from "lucide-react";
import { marcarAvisoWhatsApp, type ResultadoRegistro } from "@/actions/encomendas";
import { CodigoEncomenda } from "@/components/encomenda/codigo-encomenda";
import { classeBotao } from "@/components/portaria/botao";
import { formatarRelativo } from "@/lib/datas";
import { rotuloTipo } from "@/lib/encomenda-constantes";

export type Registrada = Extract<ResultadoRegistro, { ok: true }> & {
  /** ISO do momento em que a tela recebeu a resposta */
  registradaEm: string;
};

/**
 * Tela "Código gerado" (mockup CodigoGerado): logo após salvar, o porteiro vê o
 * código GRANDE, para quem é, e segue para avisar no WhatsApp, imprimir a
 * etiqueta ou registrar outra. O código não é segredo (vai na etiqueta e no
 * WhatsApp) - a segurança está em QUEM retira.
 */
export function CodigoGerado({
  registrada: r,
  onRegistrarOutra,
}: {
  registrada: Registrada;
  onRegistrarOutra: () => void;
}) {
  const [avisado, setAvisado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [, registrarAviso] = useTransition();

  // O <a> abre o WhatsApp em nova aba (gesto do toque, sem bloqueio de pop-up);
  // o clique também grava o aviso no histórico da encomenda.
  function aoAvisar() {
    setErro(null);
    setAvisado(true);
    registrarAviso(async () => {
      try {
        const res = await marcarAvisoWhatsApp({ id: r.id });
        if (!res.ok) {
          setAvisado(false);
          setErro(res.erro);
        }
      } catch {
        setAvisado(false);
        setErro("Não foi possível gravar o aviso. O WhatsApp pode ter aberto mesmo assim.");
      }
    });
  }

  const origem = [rotuloTipo(r.tipo), r.transportadora].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="stamp stamp-done">
          <Check className="size-3" aria-hidden /> Registrada
        </span>
        <span className="text-ink-2">
          {formatarRelativo(r.registradaEm)} · por {r.porteiroNome}
        </span>
      </div>

      <section
        aria-label="Código da encomenda"
        className="flex flex-col items-center gap-2 rounded-[14px] border-2 border-kraft bg-card px-4 py-7 text-center"
      >
        <span className="eyebrow">Código da encomenda</span>
        <CodigoEncomenda codigo={r.codigo} size="xl" />
        <div className="mt-1.5 flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1">
          <span className="font-heading text-[22px] font-semibold">{r.apartamento}</span>
          <span className="text-ink-2">·</span>
          <b className="text-lg">{r.destinatarioNome}</b>
          {origem && <span className="text-ink-2">· {origem}</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {r.linkWhatsApp ? (
          <a
            href={r.linkWhatsApp}
            target="_blank"
            rel="noopener noreferrer"
            onClick={aoAvisar}
            className={classeBotao({ variante: "okLinha", grande: true, bloco: true })}
          >
            {avisado ? <Check aria-hidden /> : <MessageCircle aria-hidden />}
            {avisado ? "Aviso aberto — avisar de novo" : "Avisar no WhatsApp"}
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled
            title={r.motivoSemWhatsApp}
            className={classeBotao({ variante: "okLinha", grande: true, bloco: true })}
          >
            <MessageCircle aria-hidden /> Avisar no WhatsApp
          </button>
        )}
        <a
          href={`/etiqueta/${r.codigo}`}
          target="_blank"
          rel="noopener noreferrer"
          className={classeBotao({ grande: true, bloco: true })}
        >
          <Printer aria-hidden /> Imprimir etiqueta
        </a>
      </div>

      {!r.linkWhatsApp && (
        <p className="flex items-start gap-2 rounded-[10px] border border-line bg-card px-3.5 py-3 text-[15px] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <span>
            {/* o motivo vem do servidor: sem telefone no apto ou destinatário que pediu para não receber WhatsApp (LGPD) */}
            {r.motivoSemWhatsApp ?? `Nenhum morador do ${r.apartamento} tem telefone cadastrado - avise por outro meio`}.
            O morador também vê a encomenda ao abrir o app.
          </span>
        </p>
      )}
      {erro && (
        <p role="alert" className="text-[15px] font-medium text-warn">
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          onClick={onRegistrarOutra}
          className={classeBotao({ variante: "primary", grande: true, className: "min-w-[220px] flex-1" })}
        >
          <Plus aria-hidden /> Registrar outra
        </button>
        <Link href="/portaria" className={classeBotao({ grande: true })}>
          Voltar à lista
        </Link>
      </div>
    </div>
  );
}
