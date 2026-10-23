/**
 * Selo do tipo de evento do livro (LogEvento.tipo) — fonte única para o painel
 * e para /admin/logs. Tipo desconhecido (dado novo/antigo) cai no selo neutro
 * com o próprio texto, nunca quebra a tela.
 */
import { Selo } from "./ui-admin";

type Tom = Parameters<typeof Selo>[0]["tom"];

export const TIPOS_EVENTO: { valor: string; rotulo: string; tom: Tom }[] = [
  { valor: "login", rotulo: "Entrada", tom: "info" },
  { valor: "logout", rotulo: "Saída", tom: "neutro" },
  { valor: "encomenda", rotulo: "Encomenda", tom: "kraft" },
  { valor: "retirada", rotulo: "Retirada", tom: "ok" },
  { valor: "cancelamento", rotulo: "Cancelamento", tom: "aviso" },
  { valor: "turno", rotulo: "Turno", tom: "info" },
  { valor: "usuario", rotulo: "Usuário", tom: "kraft" },
  { valor: "cadastro", rotulo: "Cadastro", tom: "kraft" },
  { valor: "exportacao", rotulo: "Exportação", tom: "kraft" },
  { valor: "erro", rotulo: "Erro", tom: "aviso" },
  { valor: "feedback", rotulo: "Relato", tom: "info" },
];

export function SeloTipoEvento({ tipo }: { tipo: string }) {
  const t = TIPOS_EVENTO.find((x) => x.valor === tipo);
  return <Selo tom={t?.tom ?? "neutro"}>{t?.rotulo ?? tipo}</Selo>;
}
