"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Campo de busca da lista (apto, nome ou código): filtra enquanto digita
 * (espera 300 ms de pausa) e também no Enter / lupa. A busca vive na URL (`?q=`),
 * então o filtro sobrevive ao recarregar e aos refresh automáticos de 30 s.
 */
export function BuscaPortaria({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qUrl = params.get("q") ?? "";

  const [valor, setValor] = useState(qUrl);
  const ultimoAplicado = useRef(qUrl);
  const timer = useRef<number | undefined>(undefined);

  // a URL mudou por outro caminho (ex.: "Limpar filtros"): acompanha
  useEffect(() => {
    if (qUrl !== ultimoAplicado.current) {
      ultimoAplicado.current = qUrl;
      // sincroniza com um valor externo (a URL) - não é derivável durante a renderização sem perder o que o usuário digita
      setValor(qUrl);
    }
  }, [qUrl]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function aplicar(v: string) {
    window.clearTimeout(timer.current);
    const limpo = v.trim();
    if (limpo === ultimoAplicado.current) return;
    ultimoAplicado.current = limpo;
    const p = new URLSearchParams(params.toString());
    if (limpo) p.set("q", limpo);
    else p.delete("q");
    const resto = p.toString();
    router.replace(resto ? `${pathname}?${resto}` : pathname, { scroll: false });
  }

  function aoDigitar(v: string) {
    setValor(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => aplicar(v), 300);
  }

  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(ev) => {
        ev.preventDefault();
        aplicar(valor);
      }}
    >
      <label htmlFor="busca-portaria" className="sr-only">
        Buscar por apartamento, nome ou código
      </label>
      <button
        type="submit"
        aria-label="Buscar"
        className="absolute left-0 top-0 flex size-12 items-center justify-center text-ink-3 hover:text-ink"
      >
        <Search className="size-[18px]" aria-hidden />
      </button>
      <input
        id="busca-portaria"
        type="search"
        value={valor}
        onChange={(ev) => aoDigitar(ev.target.value)}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={60}
        placeholder="apto, nome ou código"
        className="h-12 w-full rounded-[10px] border border-line bg-card pl-11 pr-11 text-[15px] outline-none placeholder:text-ink-3 focus-visible:border-kraft focus-visible:ring-3 focus-visible:ring-kraft/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {valor && (
        <button
          type="button"
          aria-label="Limpar a busca"
          onClick={() => {
            setValor("");
            aplicar("");
          }}
          className="absolute right-0 top-0 flex size-12 items-center justify-center text-ink-3 hover:text-ink"
        >
          <X className="size-[18px]" aria-hidden />
        </button>
      )}
    </form>
  );
}
