/**
 * Header carimbado pelo middleware em toda requisição que ele conferiu.
 * O layout raiz exige esse carimbo para renderizar qualquer coisa sem sessão —
 * assim uma rota que escape do matcher não vira página pública.
 * Fica em módulo próprio para o layout não importar o middleware (edge).
 */
export const HEADER_ROTA = "x-rota-verificada";
