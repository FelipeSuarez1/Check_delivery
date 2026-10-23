"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, LoaderCircle, TriangleAlert } from "lucide-react";
import { entrar } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Botão de envio com estado (evita duplo toque: cada tentativa custa um scrypt). */
function BotaoEntrar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-kraft bg-kraft px-4 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? (
        <>
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Entrando…
        </>
      ) : (
        "Entrar"
      )}
    </button>
  );
}

const campo = "h-12 rounded-[10px] bg-card px-3.5 text-base md:text-base";

export function LoginForm({
  erro,
  loginInicial,
  next,
}: {
  erro: string | null;
  loginInicial: string;
  next: string;
}) {
  const [mostrar, setMostrar] = useState(false);

  return (
    <form action={entrar} className="space-y-4">
      <input type="hidden" name="next" value={next} />

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
        <Label htmlFor="login" className="text-[13px] font-semibold text-ink-2">
          Usuário
        </Label>
        <Input
          id="login"
          name="login"
          className={campo}
          placeholder="ex.: ap11a"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={60}
          required
          autoFocus={!loginInicial}
          defaultValue={loginInicial}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="senha" className="text-[13px] font-semibold text-ink-2">
          Senha
        </Label>
        <div className="relative">
          <Input
            id="senha"
            name="senha"
            type={mostrar ? "text" : "password"}
            className={`${campo} pr-14`}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            required
            autoFocus={!!loginInicial}
          />
          <button
            type="button"
            onClick={() => setMostrar((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-[10px] text-ink-3 hover:text-ink"
            aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={mostrar}
          >
            {mostrar ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      <BotaoEntrar />
    </form>
  );
}
