"use client";

/**
 * Erro inesperado numa tela. Caso típico: a sessão de 30 dias venceu com o app
 * aberto e a próxima ação recebeu o redirecionamento do middleware em vez da
 * resposta esperada — "Entrar de novo" resolve.
 */
export default function ErroDaTela({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-line bg-card p-6 text-center">
        <p className="eyebrow">Algo deu errado</p>
        <h1 className="text-xl">Não foi possível concluir</h1>
        <p className="text-sm text-ink-2">
          Tente de novo. Se continuar, sua sessão pode ter expirado — entre novamente.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-12 w-full items-center justify-center rounded-[10px] border border-kraft bg-kraft px-4 font-semibold text-white hover:opacity-90"
        >
          Tentar de novo
        </button>
        {/* <a> de propósito (navegação completa): garante um estado limpo */}
        <a
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-[10px] border border-line bg-card px-4 font-semibold hover:bg-muted"
        >
          Entrar de novo
        </a>
      </div>
    </div>
  );
}
