"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut, Repeat, TriangleAlert, UserRound } from "lucide-react";
import { encerrarTurno } from "@/actions/turno";
import { classeBotao } from "@/components/portaria/botao";
import { abrirDialogoTurno } from "@/components/turno-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const MSG_FALHA = "Não foi possível concluir. Recarregue a página e tente de novo (a sessão pode ter expirado).";

/**
 * Botões da página de turno. Trocar/abrir usa o diálogo "Quem está de turno?" do
 * cabeçalho (um só, em todo o app); encerrar pede uma confirmação própria, porque
 * sem turno aberto ninguém consegue registrar nem entregar.
 */
export function AcoesTurno({ aberto, porteiroNome }: { aberto: boolean; porteiroNome: string | null }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function fechar(valor: boolean) {
    if (pendente) return;
    setConfirmando(valor);
    if (!valor) setErro(null);
  }

  function encerrar() {
    if (pendente) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await encerrarTurno();
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        setConfirmando(false);
        router.refresh();
      } catch {
        setErro(MSG_FALHA);
      }
    });
  }

  if (!aberto) {
    return (
      <button type="button" onClick={abrirDialogoTurno} className={classeBotao({ variante: "primary", grande: true })}>
        <UserRound aria-hidden /> Abrir turno
      </button>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={abrirDialogoTurno} className={classeBotao({ grande: true })}>
          <Repeat aria-hidden /> Trocar de porteiro
        </button>
        <button type="button" onClick={() => setConfirmando(true)} className={classeBotao({ variante: "perigo", grande: true })}>
          <LogOut aria-hidden /> Encerrar turno
        </button>
      </div>

      <Dialog open={confirmando} onOpenChange={fechar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle className="font-heading text-lg">Encerrar o turno de {porteiroNome}?</DialogTitle>
            <DialogDescription>
              Sem turno aberto não dá para registrar nem entregar encomendas. O próximo porteiro abre o dele ao
              chegar.
            </DialogDescription>
          </DialogHeader>
          {erro && (
            <p role="alert" className="flex items-start gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2.5 text-[15px] text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {erro}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => fechar(false)} disabled={pendente} className={classeBotao()}>
              Voltar
            </button>
            <button type="button" onClick={encerrar} disabled={pendente} className={classeBotao({ variante: "escuro" })}>
              {pendente && <LoaderCircle className="animate-spin" aria-hidden />}
              Encerrar turno
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
