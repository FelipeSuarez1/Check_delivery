"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SITUACOES_USUARIO } from "@/lib/admin-formato";
import type { SituacaoUsuario } from "@/lib/admin";
import { PAPEIS, ROTULO_PAPEL, type PapelUsuario } from "@/lib/papeis";
import { BTN_SECUNDARIO, CAMPO, SELECT_NATIVO } from "../_componentes/ui-admin";

/**
 * Filtros da lista de usuários: formulário GET comum (funciona sem JS). É um
 * client component de propósito: passá-lo como elemento do servidor para
 * UsuariosClient fazia o React acusar "unique key" a cada atualização da lista.
 */
export function FiltrosUsuarios({ q, papel, situacao }: { q: string; papel?: PapelUsuario; situacao?: SituacaoUsuario }) {
  return (
    <form method="get" action="/admin/usuarios" role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por login, nome ou apto"
          aria-label="Buscar usuários"
          className={`${CAMPO} pl-9`}
          maxLength={80}
          autoComplete="off"
        />
      </div>
      <select name="papel" defaultValue={papel ?? ""} aria-label="Filtrar por papel" className={`${SELECT_NATIVO} min-w-40`}>
        <option value="">Todos os papéis</option>
        {PAPEIS.map((p) => (
          <option key={p} value={p}>
            {ROTULO_PAPEL[p]}
          </option>
        ))}
      </select>
      <select name="situacao" defaultValue={situacao ?? ""} aria-label="Filtrar por situação" className={`${SELECT_NATIVO} min-w-44`}>
        <option value="">Todas as situações</option>
        {SITUACOES_USUARIO.map((s) => (
          <option key={s.valor} value={s.valor}>
            {s.rotulo}
          </option>
        ))}
      </select>
      <button type="submit" className={BTN_SECUNDARIO}>
        Filtrar
      </button>
      {(q || papel || situacao) && (
        <Link href="/admin/usuarios" className="inline-flex h-11 items-center px-2 text-sm font-semibold text-kraft-ink underline">
          Limpar
        </Link>
      )}
    </form>
  );
}
