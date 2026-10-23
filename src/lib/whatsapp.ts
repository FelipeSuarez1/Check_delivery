/**
 * Aviso por WhatsApp (22/10/2026): mensagem pronta + link wa.me. O envio é
 * MANUAL (o porteiro toca em "enviar" no WhatsApp do tablet). Isomórfico.
 */
import { rotuloTipo } from "@/lib/encomenda-constantes";

export type DadosAviso = {
  codigo: string;
  tipo: string;
  transportadora?: string | null;
  destinatarioNome: string;
  /** número do apto, ex. "11A" */
  apartamento: string;
};

/** "AURIVÂNIA SILVA" → "Aurivânia"; nomes já em caixa mista ficam como estão. */
export function primeiroNome(nome: string): string {
  const p = nome.trim().split(/\s+/)[0] ?? "";
  if (!p) return "";
  const maiusculo = p.toLocaleUpperCase("pt-BR");
  const minusculo = p.toLocaleLowerCase("pt-BR");
  if (p === maiusculo || p === minusculo) {
    return minusculo.charAt(0).toLocaleUpperCase("pt-BR") + minusculo.slice(1);
  }
  return p;
}

/**
 * "Olá, Felipe! Chegou uma encomenda para você na portaria do Espaço Tangará.
 * Código K7M3 · Caixa · Mercado Livre. Qualquer morador do 11A pode retirar
 * mostrando o código. — Portaria"
 *
 * `saudacaoNome`: quando o telefone é de OUTRO morador do apto (o destinatário
 * não tem telefone), a saudação é dele e a frase vira "para {destinatário}".
 */
export function mensagemWhatsApp(e: DadosAviso, opcoes?: { saudacaoNome?: string | null }): string {
  const destinatario = primeiroNome(e.destinatarioNome);
  const saudacao = opcoes?.saudacaoNome ? primeiroNome(opcoes.saudacaoNome) : destinatario;
  const paraVoce = !opcoes?.saudacaoNome || saudacao.toLowerCase() === destinatario.toLowerCase();
  const detalhes = [e.codigo ? `Código ${e.codigo}` : "", rotuloTipo(e.tipo), e.transportadora?.trim() ?? ""]
    .filter(Boolean)
    .join(" · ");
  const ola = saudacao ? `Olá, ${saudacao}!` : "Olá!";
  const para = paraVoce ? "para você" : `para ${destinatario || e.destinatarioNome.trim()}`;
  return `${ola} Chegou uma encomenda ${para} na portaria do Espaço Tangará. ${detalhes}. Qualquer morador do ${e.apartamento} pode retirar mostrando o código. — Portaria`;
}

/**
 * Telefone → dígitos com DDI para o wa.me. Brasil assumido: com 10–11 dígitos
 * (DDD + número) acrescenta 55; com 12–15 dígitos já traz DDI e fica como está.
 * Sem dígitos suficientes (ou DDD impossível) → null.
 */
export function telefoneParaWhatsApp(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digitos.length >= 12 && digitos.length <= 15) return digitos;
  if (digitos.length === 10 || digitos.length === 11) {
    if (Number(digitos.slice(0, 2)) < 11) return null;
    return `55${digitos}`;
  }
  return null;
}

/** https://wa.me/55<dígitos>?text=<mensagem codificada>; null se o telefone não serve. */
export function linkWhatsApp(telefone: string | null | undefined, mensagem: string): string | null {
  const numero = telefoneParaWhatsApp(telefone);
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}
