/**
 * Fluxo REAL da portaria no navegador (23/10/2026) - Playwright contra um servidor ligado.
 *
 *   LOGIN_USUARIO=<portaria|admin> LOGIN_SENHA=... FOTO=<png/jpg> [TESTE_BASE=http://localhost:3001]
 *   [PASTA=<pasta dos screenshots>] [ESPERA_ADMIN=1 quando o login e de admin] npx tsx scripts/teste-portaria.ts
 *
 * Cobre: abrir turno -> registrar (foto real) -> codigo gerado + link wa.me -> lista -> detalhe ->
 * retirada por codigo (morador e terceiro) -> teclado na tela -> codigo inexistente/ja entregue ->
 * cancelar -> historico geral e por apto -> turno -> sem rolagem lateral em 1180/768/390.
 * Tudo que cria leva "[TESTE-PORTARIA]" na observacao; limpe com scripts/limpa-teste-portaria.ts.
 * O envio ao WhatsApp NUNCA acontece: as requisicoes a wa.me sao abortadas.
 * Saida ASCII (console do Windows e cp1252); exit 1 se algum passo falhar.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { Page } from "playwright";
import { abrirNavegador } from "./_navegador";

const BASE = (process.env.TESTE_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const USUARIO = process.env.LOGIN_USUARIO;
const SENHA = process.env.LOGIN_SENHA;
const FOTO = process.env.FOTO ?? path.join(process.cwd(), "public", "icons", "icon-512.png");
const PASTA = process.env.PASTA ?? path.join(process.cwd(), "validacao-portaria");
const MARCA = "[TESTE-PORTARIA]";
const ADMIN = process.env.ESPERA_ADMIN === "1";

const prisma = new PrismaClient();
let total = 0;
let falhas = 0;
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

async function passo(nome: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    console.log(`PASS ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`FAIL ${nome} -> ${ascii(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
}
function esperar(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function foto(page: Page, nome: string) {
  fs.mkdirSync(PASTA, { recursive: true });
  // as miniaturas sao lazy: espera todas as imagens terminarem antes do screenshot
  await page
    .waitForFunction(() => Array.from(document.images).every((i) => i.complete), undefined, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(PASTA, `${nome}.png`), fullPage: true });
}

/** Sem rolagem lateral na pagina inteira (a tabela pode rolar DENTRO do proprio contêiner). */
async function semRolagemLateral(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth > d.clientWidth + 1 ? `scrollWidth ${d.scrollWidth} > clientWidth ${d.clientWidth}` : null;
  });
}

async function codigoDaTelaGerada(page: Page): Promise<string> {
  const t = await page.locator('section[aria-label="Código da encomenda"] span[aria-hidden="true"]').first().innerText();
  esperar(/^[A-Z2-9]{4}$/.test(t.trim()), `codigo invalido na tela: ${t}`);
  return t.trim();
}

async function contadorAguardando(page: Page): Promise<number> {
  const t = await page.locator('nav[aria-label="Seções da portaria"] a').first().innerText();
  return Number((/(\d+)\s*$/.exec(t.trim()) ?? [])[1]);
}

async function registrar(
  page: Page,
  opcoes: { apto: string; torre: "A" | "B"; moradorIndice?: number; outroNome?: string; transportadora: string; semTurno?: boolean }
): Promise<string> {
  await page.goto(`${BASE}/portaria/registrar`);
  await page.setInputFiles('input[type="file"]', FOTO);
  await page.waitForSelector('img[alt="Foto 1 da encomenda"]', { timeout: 15000 });
  await page.getByRole("radio", { name: `Torre ${opcoes.torre}` }).click();
  await page.fill("#numero-apto", opcoes.apto);
  if (opcoes.outroNome) {
    await page.locator("#campo-dest").getByRole("button", { name: "Outro nome…" }).click();
    await page.fill('input[aria-label="Nome do destinatário"]', opcoes.outroNome);
  } else {
    await page.locator("#campo-dest button[aria-pressed]").nth(opcoes.moradorIndice ?? 0).click();
  }
  await page.locator("#campo-tipo").getByRole("button", { name: "Caixa" }).click();
  await page.getByRole("button", { name: opcoes.transportadora, exact: true }).click();
  await page.fill("#local-guardado", "Prateleira A3 (teste)");
  await page.fill("#observacao-encomenda", MARCA);
  await page.getByRole("button", { name: "Salvar e gerar código" }).click();
  if (opcoes.semTurno) {
    // sem turno: o Salvar abre o dialogo "Quem esta de turno?" em vez de gravar
    await page.getByRole("dialog").getByText("Quem está de turno?").waitFor({ timeout: 8000 });
    await page.getByText("Abra o turno antes de registrar").waitFor({ timeout: 5000 });
    await foto(page, "01b-registrar-sem-turno-dialogo");
    await page.getByRole("dialog").getByRole("button", { name: /^José/ }).click();
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10000 });
    // a tela se atualiza sozinha com o turno novo (some a faixa e o aviso): so entao o porteiro toca em Salvar de novo
    await page.getByText("Abra o turno para registrar a encomenda").waitFor({ state: "detached", timeout: 10000 });
    await page.getByRole("button", { name: "Salvar e gerar código" }).click();
  }
  await page.waitForSelector('section[aria-label="Código da encomenda"]', { timeout: 30000 }).catch(async (e) => {
    // diagnostico: o que a tela estava dizendo quando o codigo nao apareceu
    const alerta = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    await foto(page, "falha-registrar");
    throw new Error(`codigo nao apareceu; alertas na tela: ${alerta.join(" | ") || "nenhum"} (${String(e).slice(0, 80)})`);
  });
  return codigoDaTelaGerada(page);
}

async function main() {
  if (!USUARIO || !SENHA) throw new Error("defina LOGIN_USUARIO e LOGIN_SENHA");
  fs.mkdirSync(PASTA, { recursive: true });
  const browser = await abrirNavegador();
  const contexto = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  // nunca falar com o WhatsApp de verdade
  await contexto.route(/^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//, (r) => r.abort());
  const page = await contexto.newPage();
  const errosConsole: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 404/.test(m.text())) errosConsole.push(m.text());
  });
  page.on("pageerror", (e) => errosConsole.push(`pageerror: ${e.message}`));
  // evita a janela nativa de confirm/alert travar o teste
  page.on("dialog", (d) => d.dismiss().catch(() => {}));

  await page.goto(`${BASE}/login`);
  await page.fill("#login", USUARIO);
  await page.fill("#senha", SENHA);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);

  let c1 = "";
  let c2 = "";
  let c3 = "";
  let turnoCriado = false;

  await passo("abrir turno pela faixa (se ainda nao ha turno)", async () => {
    await page.goto(`${BASE}/portaria`);
    const faixa = page.getByText("Abra o turno para registrar e entregar");
    if ((await faixa.count()) === 0) {
      console.log("  (ja havia turno aberto - usando o existente)");
      return;
    }
    await foto(page, "01-aguardando-sem-turno");
    await page.getByRole("button", { name: "Abrir turno" }).first().click();
    await page.getByRole("button", { name: /^Marcos|^José/ }).first().click();
    await faixa.waitFor({ state: "detached", timeout: 15000 });
    turnoCriado = true;
  });

  await passo("formulario vazio: Salvar diz o que falta e nao grava nada", async () => {
    await page.goto(`${BASE}/portaria/registrar`);
    await page.getByRole("button", { name: "Salvar e gerar código" }).click();
    await page.getByText("Falta tirar a foto da etiqueta, informar o apartamento").waitFor({ timeout: 5000 });
    await foto(page, "01a-registrar-faltas");
  });

  await passo("registrar encomenda 1 (foto real, morador, Mercado Livre) e ver o codigo gerado", async () => {
    let semTurno = false;
    if (turnoCriado) {
      // encerra o turno que este teste abriu, pela propria tela de turno, e registra SEM turno
      await page.goto(`${BASE}/portaria/turno`);
      await page.getByRole("button", { name: "Encerrar turno" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Encerrar turno" }).click();
      await page.getByText("Nenhum turno aberto").first().waitFor({ timeout: 15000 });
      semTurno = true;
    }
    c1 = await registrar(page, { apto: "11", torre: "A", moradorIndice: 0, transportadora: "Mercado Livre", semTurno });
    await foto(page, "02-codigo-gerado");
    const link = await page.locator('a[href^="https://wa.me/"]').getAttribute("href");
    esperar(!!link && /^https:\/\/wa\.me\/55\d{10,11}\?text=/.test(link), `link wa.me invalido: ${link}`);
    esperar(decodeURIComponent(link!).includes(c1), "mensagem do WhatsApp nao traz o codigo");
  });

  await passo("clicar em Avisar no WhatsApp marca o aviso e nao abre o WhatsApp de verdade", async () => {
    const [popup] = await Promise.all([
      contexto.waitForEvent("page", { timeout: 8000 }).catch(() => null),
      page.locator('a[href^="https://wa.me/"]').click(),
    ]);
    await popup?.close().catch(() => {});
    await page.getByText("Aviso aberto").first().waitFor({ timeout: 8000 });
    const reg = await prisma.encomenda.findUnique({ where: { codigo: c1 } });
    esperar(!!reg?.avisoWhatsAppEm, "avisoWhatsAppEm nao foi gravado");
  });

  await passo("Imprimir etiqueta aponta para /etiqueta/<codigo>", async () => {
    const href = await page.getByRole("link", { name: /Imprimir etiqueta/ }).getAttribute("href");
    esperar(href === `/etiqueta/${c1}`, `href ${href}`);
  });

  await passo("Voltar a lista: card novo aparece e o contador do cabecalho subiu", async () => {
    await page.getByRole("link", { name: "Voltar à lista" }).click();
    await page.waitForURL(`${BASE}/portaria`);
    await page.getByText(c1).first().waitFor({ timeout: 10000 });
    const n = await prisma.encomenda.count({ where: { status: "aguardando" } });
    esperar((await contadorAguardando(page)) === n, `contador ${await contadorAguardando(page)} != ${n}`);
    await foto(page, "03-aguardando-com-itens");
  });

  await passo("encomenda parada (5 dias) fica com borda vermelha e o filtro 'Ha mais de 3 dias' funciona", async () => {
    const apto = await prisma.apartamento.findUnique({ where: { numero: "21B" } });
    const porteiro = await prisma.porteiro.findFirst({ where: { ativo: true } });
    esperar(!!apto && !!porteiro, "sem apto 21B/porteiro");
    await prisma.encomenda.create({
      data: {
        codigo: "ZZ9Z",
        apartamentoId: apto!.id,
        destinatarioNome: "Parada de Teste",
        tipo: "caixa",
        transportadora: "Amazon",
        observacao: MARCA,
        recebidaEm: new Date(Date.now() - 5 * 86_400_000),
        recebidaPorPorteiroId: porteiro!.id,
      },
    }).catch(async () => {
      await prisma.encomenda.update({ where: { codigo: "ZZ9Z" }, data: { status: "aguardando", entregueEm: null } });
    });
    await page.goto(`${BASE}/portaria`);
    await page.getByText("Parada de Teste").waitFor({ timeout: 10000 });
    await page.getByRole("link", { name: /Há mais de 3 dias/ }).click();
    await page.waitForURL(/paradas=1/);
    esperar((await page.getByText("Parada de Teste").count()) === 1, "parada nao listada");
    esperar((await page.getByText(c1).count()) === 0, "nao-parada apareceu no filtro");
    await foto(page, "04-aguardando-so-paradas");
  });

  await passo("busca por apto, nome e codigo filtra a lista", async () => {
    await page.goto(`${BASE}/portaria`);
    await page.fill("#busca-portaria", "11a");
    await page.waitForURL(/q=11a/i, { timeout: 8000 });
    await page.getByText(c1).first().waitFor();
    esperar((await page.getByText("Parada de Teste").count()) === 0, "outro apto continuou na lista");
    await page.fill("#busca-portaria", c1.toLowerCase());
    await page.waitForTimeout(700);
    esperar((await page.getByText(c1).count()) >= 1, "busca por codigo");
    await page.fill("#busca-portaria", "xyzxyz");
    await page.getByText("Nenhuma encomenda encontrada").waitFor({ timeout: 8000 });
    await foto(page, "05-aguardando-busca-vazia");
    await page.getByRole("button", { name: "Limpar a busca" }).click();
    await page.getByText(c1).first().waitFor({ timeout: 8000 });
  });

  await passo("detalhe: foto, codigo, linha do tempo e botoes", async () => {
    const enc = await prisma.encomenda.findUnique({ where: { codigo: c1 } });
    await page.goto(`${BASE}/portaria/encomenda/${enc!.id}`);
    await page.getByRole("heading", { name: "Linha do tempo" }).waitFor();
    esperar((await page.getByText("Recebida na portaria").count()) === 1, "linha do tempo sem 'Recebida'");
    esperar((await page.getByText("Aviso aberto no WhatsApp").count()) === 1, "linha do tempo sem aviso");
    const imgOk = await page.locator(`img[alt*="${c1}"]`).first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
    esperar(imgOk, "foto grande nao carregou");
    esperar((await page.getByRole("link", { name: /Confirmar retirada/ }).count()) === 1, "falta Confirmar retirada");
    esperar((await page.getByRole("button", { name: /Cancelar esta encomenda/ }).count()) === 1, "falta Cancelar (deveria poder: mesmo turno)");
    await foto(page, "06-detalhe");
  });

  await passo("retirada por ?codigo= (vinda do detalhe): escolher quem retira e ver o que fica registrado", async () => {
    await page.getByRole("link", { name: /Confirmar retirada/ }).click();
    await page.waitForURL(new RegExp(`/portaria/retirada\\?codigo=${c1}`));
    await page.getByText("Quem está retirando?").waitFor();
    esperar((await page.locator("#codigo-retirada").inputValue()) === c1, "campo do codigo nao veio preenchido");
    // sem escolher ninguem: mensagem e nada entregue
    await page.getByRole("button", { name: "Confirmar entrega" }).click();
    await page.getByText("Escolha quem está retirando.").waitFor({ timeout: 5000 });
    await page.locator("#quem-retira button[aria-pressed]").first().click();
    await page.getByText(/Vai ficar registrado:/).waitFor();
    await foto(page, "07-retirada-conferencia");
  });

  await passo("confirmar entrega -> tela de sucesso -> some da lista, entra em Entregues hoje e no historico", async () => {
    await page.getByRole("button", { name: "Confirmar entrega" }).click();
    await page.getByRole("heading", { name: "Entregue" }).waitFor({ timeout: 20000 });
    await foto(page, "08-retirada-sucesso");
    await page.getByRole("link", { name: "Voltar à lista" }).click();
    await page.waitForURL(`${BASE}/portaria`);
    await page.waitForTimeout(500);
    esperar((await page.getByText(c1).count()) === 0, "encomenda entregue continuou na lista de aguardando");
    await page.goto(`${BASE}/portaria?aba=hoje`);
    await page.getByText(c1).first().waitFor({ timeout: 10000 });
    await foto(page, "09-entregues-hoje");
    await page.goto(`${BASE}/portaria/historico`);
    const linha = page.locator("tr", { hasText: c1 });
    await linha.waitFor();
    esperar((await linha.innerText()).toUpperCase().includes("ENTREGUE"), "historico sem status Entregue");
    const reg = await prisma.encomenda.findUnique({ where: { codigo: c1 }, include: { entreguePorPorteiro: true } });
    esperar(reg?.status === "entregue" && !!reg.entreguePorPorteiro, "banco sem a entrega");
  });

  await passo("codigo ja entregue e codigo inexistente: mensagem clara, sem dados", async () => {
    await page.goto(`${BASE}/portaria/retirada?codigo=${c1}`);
    await page.getByText(new RegExp(`O código ${c1} já foi entregue`)).waitFor();
    esperar((await page.getByText("Quem está retirando?").count()) === 0, "mostrou a conferencia de uma encomenda entregue");
    await page.goto(`${BASE}/portaria/retirada?codigo=ZZZ8`);
    await page.getByText(/Código ZZZ8 não encontrado/).waitFor();
    await page.goto(`${BASE}/portaria/retirada`);
    await page.fill("#codigo-retirada", "K0M3");
    await page.getByText(/nunca usam 0, O, 1 nem I/).first().waitFor();
    await foto(page, "10-retirada-codigo-invalido");
  });

  await passo("registrar encomenda 2 com 'Outro nome' e entregar a TERCEIRO pelo teclado da tela", async () => {
    c2 = await registrar(page, { apto: "261", torre: "B", outroNome: "Visita de Teste", transportadora: "Correios" });
    await page.getByRole("link", { name: "Voltar à lista" }).click();
    await page.goto(`${BASE}/portaria/retirada`);
    // digita o codigo so com o teclado da tela: numeros e a pagina de letras
    for (const ch of c2.split("")) {
      if (/\d/.test(ch)) {
        if (await page.getByRole("button", { name: "Mostrar os números" }).count()) await page.getByRole("button", { name: "Mostrar os números" }).click();
        await page.locator('[role="group"][aria-label="Teclado do código"]').getByRole("button", { name: ch, exact: true }).click();
      } else {
        if (await page.getByRole("button", { name: "Mostrar as letras" }).count()) await page.getByRole("button", { name: "Mostrar as letras" }).click();
        await page.locator('[role="group"][aria-label="Teclado do código"]').getByRole("button", { name: ch, exact: true }).click();
      }
    }
    await page.getByText("Quem está retirando?").waitFor({ timeout: 15000 });
    await foto(page, "11-retirada-teclado");
    await page.getByRole("button", { name: "Terceiro autorizado…" }).click();
    await page.getByRole("button", { name: "Confirmar entrega" }).click();
    await page.getByText("Informe o nome de quem está retirando.").waitFor({ timeout: 5000 });
    await page.fill("#terceiro-nome", "Ana Terceira");
    await page.fill("#terceiro-doc", "123456789");
    await foto(page, "12-retirada-terceiro");
    await page.getByRole("button", { name: "Confirmar entrega" }).click();
    await page.getByRole("heading", { name: "Entregue" }).waitFor({ timeout: 20000 });
    const reg = await prisma.encomenda.findUnique({ where: { codigo: c2 } });
    esperar(reg?.retiradaTerceiroNome === "Ana Terceira" && reg.retiradaTerceiroDoc === "123456789", "terceiro nao gravado");
    await page.getByRole("button", { name: "Próxima retirada" }).click();
  });

  await passo("busca por apartamento na retirada lista as pendentes e 'Entregar' abre a conferencia", async () => {
    c3 = await registrar(page, { apto: "11", torre: "A", moradorIndice: 0, transportadora: "Shopee" });
    await page.goto(`${BASE}/portaria/retirada`);
    await page.fill('input[aria-label="Buscar encomendas pendentes por apartamento ou nome"]', "11a");
    await page.getByText(c3).first().waitFor();
    await foto(page, "13-retirada-busca-apto");
    await page.getByRole("button", { name: /Entregar/ }).first().click();
    await page.getByText("Quem está retirando?").waitFor({ timeout: 15000 });
  });

  await passo("cancelar encomenda: dialogo com motivo, status cancelada e historico", async () => {
    const enc = await prisma.encomenda.findUnique({ where: { codigo: c3 } });
    await page.goto(`${BASE}/portaria/encomenda/${enc!.id}`);
    await page.getByRole("button", { name: /Cancelar esta encomenda/ }).click();
    await page.getByRole("button", { name: "Cancelar encomenda" }).click();
    await page.getByText(/Informe o motivo/).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Registrada por engano" }).click();
    await foto(page, "14-detalhe-cancelar");
    await page.getByRole("button", { name: "Cancelar encomenda" }).click();
    await page.getByText("Cancelada", { exact: true }).first().waitFor({ timeout: 15000 });
    const reg = await prisma.encomenda.findUnique({ where: { codigo: c3 } });
    esperar(reg?.status === "cancelada" && reg.canceladaMotivo === "Registrada por engano", "cancelamento nao gravado");
    // o contador "Aguardando" do cabecalho acompanha o cancelamento sem recarregar a pagina
    const restantes = await prisma.encomenda.count({ where: { status: "aguardando" } });
    await page.waitForFunction(
      (n) => /(\d+)\s*$/.exec((document.querySelector('nav[aria-label="Seções da portaria"] a')?.textContent ?? "").trim())?.[1] === String(n),
      restantes,
      { timeout: 8000 }
    );
  });

  await passo(`cancelar: ${ADMIN ? "admin ve o botao em encomenda de turno anterior" : "portaria NAO ve o botao em encomenda de turno anterior"}`, async () => {
    const turno = await prisma.turno.findFirst({ where: { fim: null }, orderBy: { inicio: "desc" } });
    const antiga = turno ? await prisma.encomenda.findFirst({ where: { status: "aguardando", recebidaEm: { lt: turno.inicio } } }) : null;
    if (!antiga) {
      console.log("  (nenhuma encomenda aguardando de turno anterior - pulado)");
      return;
    }
    await page.goto(`${BASE}/portaria/encomenda/${antiga.id}`);
    await page.getByRole("heading", { name: "Linha do tempo" }).waitFor();
    const n = await page.getByRole("button", { name: /Cancelar esta encomenda/ }).count();
    esperar(n === (ADMIN ? 1 : 0), `botao Cancelar: ${n}`);
  });

  await passo(`link Exportar CSV ${ADMIN ? "aparece" : "NAO aparece"} para ${ADMIN ? "admin" : "portaria"}`, async () => {
    for (const r of ["/portaria/historico", "/portaria/historico/11A"]) {
      await page.goto(`${BASE}${r}`);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      const n = await page.locator('a[href^="/admin/exportar"]').count();
      esperar(n === (ADMIN ? 1 : 0), `${r}: links de exportacao = ${n}`);
    }
  });

  await passo("historico geral e por apartamento (busca por 11A leva ao apto)", async () => {
    await page.goto(`${BASE}/portaria/historico?q=11A`);
    await page.waitForURL(/\/portaria\/historico\/11A/);
    await page.getByRole("heading", { name: /Apto 11A/ }).waitFor();
    esperar((await page.getByText(c1).count()) >= 1, "apto 11A sem a encomenda 1");
    await foto(page, "15-historico-apto");
    await page.goto(`${BASE}/portaria/historico?periodo=7&torre=B`);
    await page.getByText(c2).first().waitFor();
    await foto(page, "16-historico-geral-torre-b");
  });

  await passo("pagina de turno lista o turno aberto e os ultimos", async () => {
    await page.goto(`${BASE}/portaria/turno`);
    await page.getByText("Turno aberto").first().waitFor();
    await foto(page, "17-turno");
  });

  for (const [largura, altura] of [
    [1180, 820],
    [768, 1024],
    [390, 844],
  ] as const) {
    await passo(`sem rolagem lateral em ${largura}px nas telas da portaria`, async () => {
      await page.setViewportSize({ width: largura, height: altura });
      const enc = await prisma.encomenda.findUnique({ where: { codigo: c2 } });
      const rotas = [
        "/portaria",
        "/portaria?aba=hoje",
        "/portaria/registrar",
        "/portaria/retirada",
        "/portaria/retirada?codigo=" + c2,
        `/portaria/encomenda/${enc!.id}`,
        "/portaria/historico",
        "/portaria/historico/11A",
        "/portaria/turno",
      ];
      const ruins: string[] = [];
      for (const r of rotas) {
        await page.goto(`${BASE}${r}`);
        await page.waitForTimeout(400);
        const prob = await semRolagemLateral(page);
        if (prob) ruins.push(`${r}: ${prob}`);
        if (largura !== 1180) await foto(page, `m${largura}-${r.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "raiz"}`);
      }
      esperar(ruins.length === 0, ruins.join(" | "));
    });
  }
  await page.setViewportSize({ width: 1180, height: 820 });

  await passo("sem erros no console do navegador durante o fluxo", async () => {
    esperar(errosConsole.length === 0, errosConsole.slice(0, 3).join(" || "));
  });

  console.log(`\nCriados: ${[c1, c2, c3].filter(Boolean).join(", ")}${turnoCriado ? " (+ turno aberto por este teste)" : ""}`);
  console.log(`${total - falhas}/${total} passos ok`);
  await browser.close();
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(ascii(e instanceof Error ? e.message : String(e)));
  await prisma.$disconnect();
  process.exit(1);
});
