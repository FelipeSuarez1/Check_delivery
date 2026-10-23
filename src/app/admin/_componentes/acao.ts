/**
 * Conveniências de client components que chamam Server Actions de /admin.
 * A action só "lança" quando a resposta nem chega como esperado — o caso comum
 * é a sessão de 30 dias vencida com a tela aberta (o middleware devolve o login).
 */
export const MSG_FALHA_DE_REDE =
  "Não foi possível concluir. Recarregue a página e tente de novo (a sessão pode ter expirado).";

/** Resultado mínimo comum a todas as actions de cadastro/usuário. */
export type ResultadoBasico = { ok: true; aviso?: string } | { ok: false; erro: string };

/** Executa a action e converte exceção em ResultadoBasico (a tela nunca quebra). */
export async function chamar<T extends ResultadoBasico>(fn: () => Promise<T>): Promise<T | { ok: false; erro: string }> {
  try {
    return await fn();
  } catch {
    return { ok: false, erro: MSG_FALHA_DE_REDE };
  }
}
