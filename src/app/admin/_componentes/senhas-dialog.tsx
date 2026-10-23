"use client";

import { useState } from "react";
import { Check, Copy, Download, KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SenhaEmitida } from "@/actions/admin-usuarios";
import { diaLocalISO } from "@/lib/datas";
import { BTN_ESCURO, BTN_SECUNDARIO, TD, TH } from "./ui-admin";

/**
 * Resultado de criar usuário / redefinir senha / gerar logins: a ÚNICA vez que
 * a senha aparece. Só fecha pelo botão (clique fora e Esc não descartam —
 * perder a senha obrigaria a redefinir). A senha vive só no estado do pai e é
 * descartada ao fechar; o servidor guarda apenas o hash.
 */
export function SenhasDialog({ emitidas, titulo, aoFechar }: { emitidas: SenhaEmitida[]; titulo?: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [falhaCopia, setFalhaCopia] = useState(false);
  const unica = emitidas.length === 1 ? emitidas[0] : null;

  async function copiar(chave: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setFalhaCopia(false);
      setCopiado(chave);
      window.setTimeout(() => setCopiado((c) => (c === chave ? null : c)), 2500);
    } catch {
      setFalhaCopia(true);
    }
  }

  const mensagem = (e: SenhaEmitida) =>
    `Encomendas · Espaço Tangará\nEndereço: ${window.location.origin}\nUsuário: ${e.login}\nSenha provisória: ${e.senha}\n` +
    "No primeiro acesso você escolhe uma senha só sua.";

  const lista = () => emitidas.map((e) => `${e.login.padEnd(12)}${e.senha.padEnd(14)}${e.nome}`).join("\n");

  function baixar() {
    const texto =
      "# SENHAS INICIAIS - texto puro. Entregue e APAGUE este arquivo.\n" +
      "# Cada senha serve so para o primeiro acesso: o app obriga a trocar.\n" +
      "# login       senha         nome\n" +
      lista() +
      "\n";
    const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `senhas-iniciais-${diaLocalISO(new Date())}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(aberto, detalhes) => {
        // só o botão fecha: Esc e X acidentais não descartam senhas que não voltam
        if (aberto) return;
        if (detalhes.reason === "escape-key") detalhes.cancel();
      }}
    >
      <DialogContent showCloseButton={false} className={unica ? "sm:max-w-md" : "sm:max-w-xl"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-lg">
            <KeyRound className="size-5 text-kraft" aria-hidden />
            {titulo ?? (unica ? "Senha provisória" : `Senhas provisórias (${emitidas.length})`)}
          </DialogTitle>
          <DialogDescription render={<div />} className="text-sm text-ink-2">
            <p className="rounded-[10px] border border-kraft/30 bg-kraft-soft px-3 py-2.5 text-kraft-ink">
              <b>Anote agora: esta é a única vez que {unica ? "a senha aparece" : "as senhas aparecem"}.</b> Depois só o
              resumo fica no sistema. No primeiro acesso {unica ? "a pessoa é obrigada" : "cada pessoa é obrigada"} a escolher uma
              senha própria.
            </p>
          </DialogDescription>
        </DialogHeader>

        {unica ? (
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 rounded-[10px] border border-line bg-paper px-4 py-3">
            <dt className="eyebrow">Usuário</dt>
            <dd className="font-mono text-base font-semibold break-all" data-testid="login-emitido">
              {unica.login}
            </dd>
            <dt className="eyebrow">Nome</dt>
            <dd className="text-sm break-words">{unica.nome}</dd>
            <dt className="eyebrow">Senha</dt>
            <dd className="codigo text-xl break-all select-all" data-testid="senha-emitida">
              {unica.senha}
            </dd>
          </dl>
        ) : (
          <div className="max-h-[50dvh] overflow-auto rounded-[10px] border border-line [contain:layout]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper">
                <tr>
                  <th className={TH}>Usuário</th>
                  <th className={TH}>Nome</th>
                  <th className={TH}>Senha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {emitidas.map((e) => (
                  <tr key={e.login} data-login={e.login}>
                    <td className={`${TD} font-mono font-semibold`}>{e.login}</td>
                    <td className={TD}>{e.nome}</td>
                    <td className={`${TD} codigo select-all`} data-testid="senha-emitida">
                      {e.senha}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {falhaCopia && (
          <p role="alert" className="text-sm text-warn">
            Não foi possível copiar automaticamente — selecione o texto e copie à mão.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {unica ? (
            <>
              <button type="button" className={BTN_SECUNDARIO} onClick={() => copiar("senha", unica.senha)}>
                {copiado === "senha" ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copiado === "senha" ? "Copiada" : "Copiar senha"}
              </button>
              <button type="button" className={BTN_SECUNDARIO} onClick={() => copiar("mensagem", mensagem(unica))}>
                {copiado === "mensagem" ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copiado === "mensagem" ? "Copiada" : "Copiar mensagem pronta"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={BTN_SECUNDARIO} onClick={() => copiar("lista", lista())}>
                {copiado === "lista" ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copiado === "lista" ? "Copiada" : "Copiar lista"}
              </button>
              <button type="button" className={BTN_SECUNDARIO} onClick={baixar}>
                <Download className="size-4" aria-hidden />
                Baixar .txt
              </button>
            </>
          )}
          <button type="button" className={BTN_ESCURO} onClick={aoFechar}>
            Já anotei — fechar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
