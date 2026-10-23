/**
 * Telas da portaria quando NINGUEM do apartamento tem telefone, na digitacao do apto e quando o destinatario
 * RECUSOU o aviso por WhatsApp (23/10/2026).
 * Cria o apartamento descartavel "991A" com 1 morador sem telefone, registra uma encomenda pela tela e
 * confere: codigo gerado com aviso "sem telefone" + botao do WhatsApp desabilitado, a mesma explicacao no
 * detalhe, a sugestao "Quis dizer 261A?" e o aviso de apto inexistente.
 * Cria tambem o "992A" com "Teste Aceita" e "Teste Recusou" (ambos com telefone; o 2o recusou o WhatsApp - LGPD) e
 * confere: marcador (sino cortado + title) no chip de quem recusou, nota ao escolhe-lo, "codigo gerado" e detalhe
 * com o motivo e o botao desabilitado (nenhum link wa.me), linha do tempo "Sem aviso no WhatsApp" e, para quem
 * aceita, o botao habilitado com o link do telefone dele. Apaga tudo (inclusive os arquivos de foto).
 *
 *   LOGIN_USUARIO=<portaria|admin> LOGIN_SENHA=... FOTO=<png/jpg> TESTE_BASE=http://localhost:3011 PASTA=<screenshots>
 *   npx tsx scripts/teste-portaria-sem-telefone.ts
 * Precisa de turno aberto (rode depois de scripts/teste-portaria.ts ou abra pelo cabecalho). Saida em ASCII.
 */
import { unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { abrirNavegador } from "./_navegador";
const prisma = new PrismaClient();
const BASE = process.env.TESTE_BASE!;
const PASTA = process.env.PASTA!;
const APTOS = ["991A", "992A"];

function exigir(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`PASS ${msg}`);
}

async function limparApto(numero: string) {
  const apto = await prisma.apartamento.findUnique({ where: { numero } });
  if (!apto) return;
  const fotos = await prisma.fotoEncomenda.findMany({ where: { encomenda: { apartamentoId: apto.id } } });
  for (const f of fotos) await unlink(path.join(process.cwd(), "uploads", "encomendas", f.arquivo)).catch(() => {});
  await prisma.fotoEncomenda.deleteMany({ where: { encomenda: { apartamentoId: apto.id } } });
  await prisma.encomenda.deleteMany({ where: { apartamentoId: apto.id } });
  await prisma.morador.deleteMany({ where: { apartamentoId: apto.id } });
  await prisma.apartamento.delete({ where: { id: apto.id } });
}

async function main() {
  for (const n of APTOS) await limparApto(n); // sobras de uma execucao que caiu no meio
  const apto = await prisma.apartamento.create({ data: { numero: "991A", torre: "A", andar: 99 } });
  await prisma.morador.create({ data: { apartamentoId: apto.id, nome: "Teste Sem Telefone", telefone: null } });
  const apto2 = await prisma.apartamento.create({ data: { numero: "992A", torre: "A", andar: 99 } });
  await prisma.morador.create({ data: { apartamentoId: apto2.id, nome: "Teste Aceita", telefone: "11922222222" } });
  await prisma.morador.create({ data: { apartamentoId: apto2.id, nome: "Teste Recusou", telefone: "11911111111", avisoWhatsApp: false } });
  const browser = await abrirNavegador();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
    await page.goto(`${BASE}/login`);
    await page.fill("#login", process.env.LOGIN_USUARIO!);
    await page.fill("#senha", process.env.LOGIN_SENHA!);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
    await page.goto(`${BASE}/portaria/registrar`);
    await page.setInputFiles('input[type="file"]', process.env.FOTO!);
    await page.waitForSelector('img[alt="Foto 1 da encomenda"]');
    await page.fill("#numero-apto", "991");
    await page.locator("#campo-dest button[aria-pressed]").first().click();
    await page.fill("#observacao-encomenda", "[TESTE-PORTARIA]");
    await page.getByRole("button", { name: "Salvar e gerar código" }).click();
    await page.getByText(/Nenhum morador do 991A tem telefone cadastrado/).waitFor({ timeout: 20000 });
    const desabilitado = await page.getByRole("button", { name: "Avisar no WhatsApp" }).isDisabled();
    console.log("registrar: aviso sem telefone ok; botao desabilitado =", desabilitado);
    await page.screenshot({ path: path.join(PASTA, "30-codigo-gerado-sem-telefone.png"), fullPage: true });
    const enc = await prisma.encomenda.findFirst({ where: { apartamentoId: apto.id } });
    await page.goto(`${BASE}/portaria/encomenda/${enc!.id}`);
    await page.getByText(/Nenhum morador do 991A tem telefone cadastrado/).waitFor();
    console.log("detalhe: explicacao sem telefone ok; botao desabilitado =", await page.getByRole("button", { name: "Avisar no WhatsApp" }).isDisabled());
    await page.screenshot({ path: path.join(PASTA, "31-detalhe-sem-telefone.png"), fullPage: true });

    // ---- destinatario que RECUSOU o aviso por WhatsApp (LGPD)
    await page.goto(`${BASE}/portaria/registrar`);
    await page.setInputFiles('input[type="file"]', process.env.FOTO!);
    await page.waitForSelector('img[alt="Foto 1 da encomenda"]');
    await page.fill("#numero-apto", "992");
    const chipRecusou = page.locator('#campo-dest button[title="não recebe WhatsApp"]');
    await chipRecusou.waitFor();
    exigir((await chipRecusou.count()) === 1 && (await chipRecusou.innerText()).includes("Teste Recusou"), "registrar: so o chip de quem recusou leva o marcador (sino cortado + title)");
    const alturaChip = (await chipRecusou.boundingBox())!.height;
    exigir(alturaChip >= 34, `registrar: chip do marcador mantem a altura (${Math.round(alturaChip)} px)`);
    exigir((await page.locator("#campo-dest button[aria-pressed]", { hasText: "Teste Aceita" }).getAttribute("title")) === null, "registrar: o chip de quem aceita nao tem marcador");
    await chipRecusou.click();
    await page.getByText(/Teste Recusou pediu para não receber avisos no WhatsApp: esta encomenda não gera o link/).waitFor();
    await page.waitForTimeout(500); // fim da transicao de cor do chip selecionado
    await page.screenshot({ path: path.join(PASTA, "33-registrar-chip-recusou.png") });
    await page.fill("#observacao-encomenda", "[TESTE-PORTARIA]");
    await page.getByRole("button", { name: "Salvar e gerar código" }).click();
    await page.getByText(/Teste Recusou pediu para não receber avisos no WhatsApp\. O morador também vê a encomenda/).waitFor({ timeout: 20000 });
    exigir(await page.getByRole("button", { name: "Avisar no WhatsApp" }).isDisabled(), "codigo gerado (recusou): botao do WhatsApp desabilitado");
    exigir((await page.locator('a[href^="https://wa.me"]').count()) === 0, "codigo gerado (recusou): nenhum link wa.me na tela");
    await page.screenshot({ path: path.join(PASTA, "34-codigo-gerado-recusou.png"), fullPage: true });
    const encRecusou = await prisma.encomenda.findFirst({ where: { apartamentoId: apto2.id }, orderBy: { id: "desc" } });
    await page.goto(`${BASE}/portaria/encomenda/${encRecusou!.id}`);
    await page.getByText(/Teste Recusou pediu para não receber avisos no WhatsApp\./).first().waitFor();
    exigir(await page.getByRole("button", { name: "Avisar no WhatsApp" }).isDisabled(), "detalhe (recusou): botao do WhatsApp desabilitado");
    exigir((await page.getByText("Sem aviso no WhatsApp").count()) === 1, "detalhe (recusou): linha do tempo diz 'Sem aviso no WhatsApp'");
    exigir((await page.locator('a[href^="https://wa.me"]').count()) === 0, "detalhe (recusou): nenhum link wa.me na tela");
    await page.screenshot({ path: path.join(PASTA, "35-detalhe-recusou.png"), fullPage: true });

    // ---- quem aceita, no mesmo apartamento: o botao funciona e o link leva o telefone DELE
    await page.goto(`${BASE}/portaria/registrar`);
    await page.setInputFiles('input[type="file"]', process.env.FOTO!);
    await page.waitForSelector('img[alt="Foto 1 da encomenda"]');
    await page.fill("#numero-apto", "992");
    await page.locator("#campo-dest button[aria-pressed]", { hasText: "Teste Aceita" }).click();
    await page.fill("#observacao-encomenda", "[TESTE-PORTARIA]");
    await page.getByRole("button", { name: "Salvar e gerar código" }).click();
    const linkAceita = page.locator('a[href^="https://wa.me/5511922222222"]');
    await linkAceita.waitFor({ timeout: 20000 });
    exigir((await linkAceita.count()) === 1 && !(await page.getByRole("button", { name: "Avisar no WhatsApp" }).isVisible().catch(() => false)), "codigo gerado (aceita): link wa.me com o telefone de quem aceita");
    await page.screenshot({ path: path.join(PASTA, "36-codigo-gerado-aceita.png"), fullPage: true });

    // registrar com apto inexistente / sugestao
    await page.goto(`${BASE}/portaria/registrar`);
    await page.fill("#numero-apto", "26");
    await page.getByRole("button", { name: /Quis dizer 261A/ }).waitFor();
    await page.screenshot({ path: path.join(PASTA, "32-registrar-sugestao-apto.png") });
    await page.getByRole("button", { name: /Quis dizer 261A/ }).click();
    console.log("sugestao 261A aplicada:", await page.inputValue("#numero-apto"));
    await page.fill("#numero-apto", "27");
    await page.getByText(/Não existe o apartamento 27A/).waitFor();
    console.log("apto inexistente 27A: aviso ok");
  } finally {
    await browser.close();
    for (const n of APTOS) await limparApto(n);
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
