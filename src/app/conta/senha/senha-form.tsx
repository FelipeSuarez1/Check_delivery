"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, LoaderCircle, TriangleAlert } from "lucide-react";
import { trocarSenha } from "@/actions/conta";
import { sair } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const campo = "h-12 rounded-[10px] bg-card px-3.5 text-base md:text-base";

export function SenhaForm({
  primeiroAcesso,
  destino,
}: {
  primeiroAcesso: boolean;
  /** tela inicial do papel (para onde "Voltar" leva) */
  destino: string;
}) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pendente) return;
    if (nova.length < 8) return setErro("A nova senha precisa ter pelo menos 8 caracteres");
    if (nova !== confirmacao) return setErro("A confirmação não confere com a nova senha");
    if (nova === atual) return setErro("A nova senha precisa ser diferente da atual");
    setErro(null);
    iniciar(async () => {
      let r: { ok: boolean; erro?: string };
      try {
        r = await trocarSenha({ atual, nova });
      } catch {
        setErro("Não foi possível trocar a senha agora. Tente de novo.");
        return;
      }
      if (!r.ok) return setErro(r.erro ?? "Não foi possível trocar a senha");
      setAtual("");
      setNova("");
      setConfirmacao("");
      setFeito(true);
      // "/" não tem tela: o middleware manda cada papel para a sua inicial
      if (primeiroAcesso) router.replace("/");
    });
  }

  if (feito) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-ok-soft text-ok">
          <Check className="size-6" aria-hidden />
        </div>
        <p className="font-semibold">Senha alterada</p>
        <p className="text-sm text-ink-2">
          {primeiroAcesso ? "Abrindo o app…" : "Nos outros aparelhos você precisará entrar de novo."}
        </p>
        {!primeiroAcesso && (
          <Link
            href={destino}
            className="inline-flex h-12 w-full items-center justify-center rounded-[10px] border border-kraft bg-kraft px-4 font-semibold text-white hover:opacity-90"
          >
            Voltar
          </Link>
        )}
      </div>
    );
  }

  const tipo = mostrar ? "text" : "password";

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      {erro && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {erro}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="atual" className="text-[13px] font-semibold text-ink-2">
          {primeiroAcesso ? "Senha que você recebeu" : "Senha atual"}
        </Label>
        <Input
          id="atual"
          type={tipo}
          className={campo}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={200}
          value={atual}
          onChange={(e) => setAtual(e.target.value)}
          autoFocus
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nova" className="text-[13px] font-semibold text-ink-2">
          Nova senha
        </Label>
        <Input
          id="nova"
          type={tipo}
          className={campo}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={72}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          aria-describedby="dica-nova"
          required
        />
        <p id="dica-nova" className="text-xs text-ink-3">
          Mínimo de 8 caracteres. Evite sequências (12345678) e o seu usuário.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmacao" className="text-[13px] font-semibold text-ink-2">
          Repita a nova senha
        </Label>
        <Input
          id="confirmacao"
          type={tipo}
          className={campo}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={72}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          required
        />
      </div>

      <button
        type="button"
        onClick={() => setMostrar((v) => !v)}
        aria-pressed={mostrar}
        className="inline-flex h-11 items-center gap-2 rounded-[10px] px-2 text-sm font-medium text-ink-2 hover:text-ink"
      >
        {mostrar ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        {mostrar ? "Ocultar senhas" : "Mostrar senhas"}
      </button>

      <button
        type="submit"
        disabled={pendente}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-kraft bg-kraft px-4 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
      >
        {pendente ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Salvando…
          </>
        ) : (
          "Salvar nova senha"
        )}
      </button>

    </form>
  );
}

/** Saída para quem abriu o primeiro acesso no aparelho errado (form separado: o principal faz preventDefault). */
export function SairSemTrocar() {
  return (
    <form action={sair} className="mt-4 border-t border-line pt-3 text-center">
      <button
        type="submit"
        className="inline-flex h-11 items-center justify-center rounded-[10px] px-3 text-sm font-medium text-ink-2 hover:text-ink"
      >
        Sair sem trocar
      </button>
    </form>
  );
}
