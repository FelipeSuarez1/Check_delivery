import Link from "next/link";

/** 404 em português, no visual do app (o padrão do Next vem em inglês). */
export default function NaoEncontrado() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-line bg-card p-6 text-center">
        <p className="eyebrow">Erro 404</p>
        <h1 className="text-xl">Página não encontrada</h1>
        <p className="text-sm text-ink-2">O endereço não existe ou você não tem acesso a ele.</p>
        <Link
          href="/"
          className="inline-flex h-12 w-full items-center justify-center rounded-[10px] border border-kraft bg-kraft px-4 font-semibold text-white hover:opacity-90"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
