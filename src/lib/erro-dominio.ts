/**
 * Violação de regra de negócio com mensagem pronta para a tela (pt-BR).
 * As actions devolvem `e.message` ao usuário só para este tipo; qualquer outro
 * erro vira mensagem genérica + log (nunca vaza detalhe interno).
 */
export class ErroDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDominio";
  }
}
