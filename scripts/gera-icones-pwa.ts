/**
 * Gera os icones do app instalavel (PWA) em public/icons/.
 * Uso: npx tsx scripts/gera-icones-pwa.ts
 *
 * Desenho: o pacote (lucide "package", o mesmo do cabecalho e do login) em traco
 * branco sobre quadrado kraft. Renderizado pelo chromium do Playwright, sem
 * dependencia extra (mesmo metodo do site financeiro).
 */
import path from "node:path";
import fs from "node:fs/promises";
import { abrirNavegador } from "./_navegador";

const DIR = path.join(process.cwd(), "public", "icons");
const FUNDO = "#C47A2C"; // --kraft
const TRACO = "#FFFFFF";

/** Icone "package" do lucide (ISC) em viewBox 24x24. */
const PACOTE = `
  <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/>
  <path d="M12 22V12"/>
  <polyline points="3.29 7 12 12 20.71 7"/>
  <path d="m7.5 4.27 9 5.15"/>
`;

/**
 * @param escala fracao do quadrado ocupada pelo simbolo. O icone "maskable" e
 * recortado em circulo pelo Android, entao o desenho precisa caber na zona
 * segura (~60%); o icone comum pode ser maior.
 */
function html(tamanho: number, escala: number, raio: number): string {
  const s = Math.round(tamanho * escala);
  const off = Math.round((tamanho - s) / 2);
  return `<!doctype html><html><body style="margin:0;background:transparent">
  <svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 ${tamanho} ${tamanho}">
    <rect width="${tamanho}" height="${tamanho}" rx="${raio}" fill="${FUNDO}"/>
    <g transform="translate(${off} ${off}) scale(${s / 24})"
       fill="none" stroke="${TRACO}" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round">${PACOTE}</g>
  </svg></body></html>`;
}

async function main() {
  await fs.mkdir(DIR, { recursive: true });
  const navegador = await abrirNavegador();
  const pagina = await navegador.newPage();

  const alvos = [
    { arquivo: "icon-192.png", tamanho: 192, escala: 0.62, raio: 40, transparente: true },
    { arquivo: "icon-512.png", tamanho: 512, escala: 0.62, raio: 108, transparente: true },
    // maskable: fundo sangra ate a borda (raio 0) e simbolo menor
    { arquivo: "icon-maskable-512.png", tamanho: 512, escala: 0.46, raio: 0, transparente: false },
    // iOS aplica o proprio arredondamento e nao aceita transparencia
    { arquivo: "apple-touch-icon.png", tamanho: 180, escala: 0.6, raio: 0, transparente: false },
  ];

  for (const a of alvos) {
    await pagina.setViewportSize({ width: a.tamanho, height: a.tamanho });
    await pagina.setContent(html(a.tamanho, a.escala, a.raio));
    await pagina.screenshot({ path: path.join(DIR, a.arquivo), omitBackground: a.transparente });
    console.log(`gerado public/icons/${a.arquivo} (${a.tamanho}px)`);
  }

  await navegador.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
