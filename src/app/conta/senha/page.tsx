import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { estadoDaSessao } from "@/lib/auth";
import { ROTA_INICIAL } from "@/lib/papeis";
import { SairSemTrocar, SenhaForm } from "./senha-form";

export const metadata: Metadata = {
  title: "Trocar senha",
};

/**
 * Troca da própria senha — qualquer papel logado. Sem shell de área: é a única
 * tela que abre no primeiro acesso (o layout raiz força o redirecionamento
 * para cá enquanto `precisaTrocarSenha`).
 */
export default async function TrocarSenhaPage() {
  const estado = await estadoDaSessao();
  if (estado.estado !== "valida") redirect("/login");
  const { sessao, precisaTrocarSenha } = estado;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-kraft text-white">
            <KeyRound className="size-7" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="eyebrow">{sessao.nome}</p>
            <h1 className="text-2xl leading-tight">
              {precisaTrocarSenha ? "Escolha a sua senha" : "Trocar senha"}
            </h1>
          </div>
          {precisaTrocarSenha && (
            <p className="rounded-[10px] border border-kraft/30 bg-kraft-soft px-3 py-2.5 text-left text-sm text-kraft-ink">
              É o seu primeiro acesso: a senha que você recebeu serve só para entrar agora. Escolha uma
              senha só sua para continuar.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(31,29,26,.04)] sm:p-6">
          <SenhaForm primeiroAcesso={precisaTrocarSenha} destino={ROTA_INICIAL[sessao.papel]} />
          {precisaTrocarSenha && <SairSemTrocar />}
        </div>
      </div>
    </main>
  );
}
