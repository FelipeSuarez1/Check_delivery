"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, Info, LoaderCircle, MessageCircle, Printer, TriangleAlert } from "lucide-react";
import { cancelarEncomenda, marcarAvisoWhatsApp } from "@/actions/encomendas";
import { classeBotao } from "@/components/portaria/botao";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const MSG_FALHA = "Não foi possível concluir. Recarregue a página e tente de novo (a sessão pode ter expirado).";

const MOTIVOS_RAPIDOS = ["Registrada por engano", "Cadastro duplicado", "Devolvida ao entregador"];

/**
 * Botões do detalhe da encomenda (só aparecem para quem está `aguardando`):
 * Confirmar retirada · Avisar no WhatsApp · Imprimir etiqueta · Cancelar.
 *
 * O WhatsApp é um <a> de verdade (o gesto do toque abre a nova aba sem
 * bloqueio de pop-up); o clique também chama `marcarAvisoWhatsApp` para gravar
 * o aviso no histórico. Quem decide se pode cancelar é a action - `podeCancelar`
 * só esconde o botão (portaria: apenas no turno em que registrou; admin: sempre).
 */
export function AcoesEncomendaClient({
  id,
  codigo,
  apartamento,
  linkWhatsApp,
  semTelefone,
  podeCancelar,
  jaAvisada,
}: {
  id: number;
  codigo: string;
  apartamento: string;
  /** link wa.me pronto, ou null quando ninguém do apto tem telefone */
  linkWhatsApp: string | null;
  /** explicação mostrada quando não há telefone */
  semTelefone: string | null;
  podeCancelar: boolean;
  jaAvisada: boolean;
}) {
  const router = useRouter();
  const [, registrarAviso] = useTransition();
  const [erroAviso, setErroAviso] = useState<string | null>(null);

  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erroCancelar, setErroCancelar] = useState<string | null>(null);
  const [pendente, cancelar] = useTransition();

  function aoAvisar() {
    setErroAviso(null);
    registrarAviso(async () => {
      try {
        const r = await marcarAvisoWhatsApp({ id });
        if (!r.ok) setErroAviso(r.erro);
        else router.refresh();
      } catch {
        setErroAviso(MSG_FALHA);
      }
    });
  }

  function fecharCancelar(aberto: boolean) {
    if (pendente) return;
    setCancelando(aberto);
    if (!aberto) {
      setErroCancelar(null);
      setMotivo("");
    }
  }

  function confirmarCancelamento() {
    if (pendente) return;
    if (motivo.trim().length < 3) {
      setErroCancelar("Informe o motivo do cancelamento (mínimo 3 letras).");
      return;
    }
    setErroCancelar(null);
    cancelar(async () => {
      try {
        const r = await cancelarEncomenda({ id, motivo });
        if (!r.ok) {
          setErroCancelar(r.erro);
          return;
        }
        setCancelando(false);
        setMotivo("");
        router.refresh();
      } catch {
        setErroCancelar(MSG_FALHA);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Link href={`/portaria/retirada?codigo=${codigo}`} className={classeBotao({ variante: "ok", grande: true, bloco: true })}>
        <Check aria-hidden /> Confirmar retirada
      </Link>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {linkWhatsApp ? (
          <a
            href={linkWhatsApp}
            target="_blank"
            rel="noopener noreferrer"
            onClick={aoAvisar}
            className={classeBotao({ variante: "okLinha", grande: true, bloco: true })}
          >
            <MessageCircle aria-hidden /> {jaAvisada ? "Avisar de novo" : "Avisar no WhatsApp"}
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled
            className={classeBotao({ variante: "okLinha", grande: true, bloco: true })}
          >
            <MessageCircle aria-hidden /> Avisar no WhatsApp
          </button>
        )}
        <a
          href={`/etiqueta/${codigo}`}
          target="_blank"
          rel="noopener noreferrer"
          className={classeBotao({ grande: true, bloco: true })}
        >
          <Printer aria-hidden /> Imprimir etiqueta
        </a>
      </div>

      {!linkWhatsApp && (
        <p className="flex items-start gap-2 rounded-[10px] border border-line bg-card px-3 py-2.5 text-[15px] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          {semTelefone ?? `Nenhum morador do ${apartamento} tem telefone cadastrado — avise por outro meio.`}
        </p>
      )}
      {erroAviso && (
        <p role="alert" className="flex items-start gap-2 text-[15px] font-medium text-warn">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {erroAviso}
        </p>
      )}

      {podeCancelar && (
        <button type="button" onClick={() => setCancelando(true)} className={classeBotao({ variante: "perigo", bloco: true })}>
          <Ban aria-hidden /> Cancelar esta encomenda
        </button>
      )}

      <Dialog open={cancelando} onOpenChange={fecharCancelar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-heading text-lg">Cancelar a encomenda {codigo}?</DialogTitle>
            <DialogDescription>
              Ela sai da lista de aguardando e o código deixa de valer. O registro continua no histórico com o motivo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="motivo-cancelamento" className="text-[15px] font-semibold text-ink-2">
              Motivo
            </label>
            <div className="flex flex-wrap gap-2">
              {MOTIVOS_RAPIDOS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMotivo(m);
                    setErroCancelar(null);
                  }}
                  disabled={pendente}
                  className="chip h-11 cursor-pointer transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {m}
                </button>
              ))}
            </div>
            <Textarea
              id="motivo-cancelamento"
              value={motivo}
              onChange={(ev) => {
                setMotivo(ev.target.value);
                setErroCancelar(null);
              }}
              disabled={pendente}
              maxLength={200}
              rows={2}
              placeholder="Escreva o motivo"
              className="min-h-20 rounded-[10px] bg-card px-3 py-2.5 text-base md:text-base"
            />
          </div>

          {erroCancelar && (
            <p role="alert" className="flex items-start gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2.5 text-[15px] text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {erroCancelar}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => fecharCancelar(false)} disabled={pendente} className={classeBotao()}>
              Voltar
            </button>
            <button
              type="button"
              onClick={confirmarCancelamento}
              disabled={pendente}
              className={classeBotao({ variante: "primary", className: "border-warn bg-warn hover:border-warn hover:bg-warn hover:brightness-95" })}
            >
              {pendente ? <LoaderCircle className="animate-spin" aria-hidden /> : <Ban aria-hidden />}
              Cancelar encomenda
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
