"use client";

import { createContext, useContext, useMemo } from "react";
import { papelOperaPortaria, type PapelUsuario } from "@/lib/papeis";

type Valor = { papel: PapelUsuario | null; apartamentoId: number | null };

/**
 * Papel (e apartamento) do usuário logado, disponível para qualquer componente
 * client — evita passar a prop por todas as telas só para esconder um botão.
 * É APENAS para a interface: a autorização de verdade está nas server actions.
 */
const SessaoContexto = createContext<Valor>({ papel: null, apartamentoId: null });

export function SessaoProvider({
  papel,
  apartamentoId = null,
  children,
}: {
  papel: PapelUsuario;
  apartamentoId?: number | null;
  children: React.ReactNode;
}) {
  const valor = useMemo(() => ({ papel, apartamentoId }), [papel, apartamentoId]);
  return <SessaoContexto.Provider value={valor}>{children}</SessaoContexto.Provider>;
}

export function usePapel(): PapelUsuario | null {
  return useContext(SessaoContexto).papel;
}

/** Apartamento da sessão do morador (null para admin/portaria). */
export function useApartamentoId(): number | null {
  return useContext(SessaoContexto).apartamentoId;
}

/** true para quem registra/entrega encomendas (portaria e admin). */
export function useOperaPortaria(): boolean {
  return papelOperaPortaria(useContext(SessaoContexto).papel);
}

/** true quando o usuário logado é administrador. */
export function useEhAdmin(): boolean {
  return useContext(SessaoContexto).papel === "admin";
}
