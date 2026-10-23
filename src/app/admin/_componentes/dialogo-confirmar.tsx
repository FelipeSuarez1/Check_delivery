"use client";

import { useState, useTransition, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chamar, type ResultadoBasico } from "./acao";
import { AvisoErro, BTN_PERIGO, BTN_PRIMARIO, BTN_SECUNDARIO } from "./ui-admin";

/**
 * Confirmação de ação sensível (desativar, redefinir senha, excluir). O erro
 * devolvido pela action aparece DENTRO do diálogo (role=alert) e o diálogo
 * continua aberto; sucesso fecha e avisa o pai com a mensagem da action.
 * Renderize condicionalmente (`{alvo && <DialogoConfirmar … />}`): cada abertura
 * começa limpa.
 */
export function DialogoConfirmar({
  titulo,
  children,
  rotuloConfirmar,
  perigo = false,
  aoConfirmar,
  aoConcluir,
  aoFechar,
}: {
  titulo: string;
  children: ReactNode;
  rotuloConfirmar: string;
  perigo?: boolean;
  aoConfirmar: () => Promise<ResultadoBasico>;
  /** recebe o aviso opcional da action ("Nada mudou", "foi apenas desativado"…) */
  aoConcluir: (aviso?: string) => void;
  aoFechar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await chamar(aoConfirmar);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      aoConcluir(r.aviso);
    });
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !pendente && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-heading text-lg">{titulo}</DialogTitle>
          <DialogDescription render={<div />} className="space-y-2 text-sm text-ink-2">
            {children}
          </DialogDescription>
        </DialogHeader>
        {erro && <AvisoErro>{erro}</AvisoErro>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={BTN_SECUNDARIO} onClick={aoFechar} disabled={pendente}>
            Cancelar
          </button>
          <button type="button" className={perigo ? BTN_PERIGO : BTN_PRIMARIO} onClick={confirmar} disabled={pendente}>
            {pendente && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
            {rotuloConfirmar}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
