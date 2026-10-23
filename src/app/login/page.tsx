import type { Metadata } from "next";
import { Package } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar",
};

const MENSAGEM_ERRO: Record<string, string> = {
  "1": "Usuário ou senha incorretos.",
  "2": "Muitas tentativas — aguarde um minuto e tente de novo.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const erro = typeof sp.erro === "string" ? (MENSAGEM_ERRO[sp.erro] ?? null) : null;
  const loginDigitado = typeof sp.login === "string" ? sp.login.slice(0, 60) : "";
  const next = typeof sp.next === "string" ? sp.next.slice(0, 500) : "";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-kraft text-white">
            <Package className="size-7" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="eyebrow">Espaço Tangará</p>
            <h1 className="text-[26px] leading-tight">Encomendas · Espaço Tangará</h1>
          </div>
          <p className="text-sm text-ink-2">Acesso restrito aos moradores e à portaria.</p>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(31,29,26,.04)] sm:p-6">
          <LoginForm erro={erro} loginInicial={loginDigitado} next={next} />
        </div>

        <p className="text-center text-[13px] text-ink-3">
          Primeiro acesso? Entre com a senha que você recebeu — o app pede para você escolher uma nova.
        </p>
      </div>
    </main>
  );
}
