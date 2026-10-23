import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_SESSAO,
  destinoPosLoginParaPapel,
  segredoSessaoValido,
  verificarSessao,
} from "@/lib/sessao-token";
import { ROTA_INICIAL, rotaPermitida, rotaPublica } from "@/lib/papeis";
import { HEADER_ROTA } from "@/lib/rota-header";

/**
 * Porteiro do app: TUDO exige login (nomes, endereços e fotos de moradores — LGPD).
 *
 * - sem sessão → /login (guardando o destino em ?next=, só para navegação de página);
 * - logado em /login → tela inicial do papel;
 * - "/" → tela inicial do papel;
 * - rota fora da allowlist do papel (lib/papeis.ts → rotaPermitida) → 404 aqui
 *   mesmo, antes de qualquer código de página rodar. O layout raiz, os layouts
 *   de área e as pages repetem a conferência (defesa em profundidade);
 * - fail-closed: sem AUTH_SECRET não há como validar assinatura → 503, nada passa.
 *
 * Roda no edge: só pode importar módulos sem Node/Prisma (sessao-token, papeis,
 * rota-header). Não dá para conferir o banco aqui — por isso `precisaTrocarSenha`,
 * usuário desativado e senha trocada são tratados no layout raiz (lib/auth.ts).
 *
 * Next 16 renomeou "middleware" para "proxy" (o nome antigo segue funcionando,
 * só emite aviso): migrar é renomear este arquivo para src/proxy.ts e a função
 * para `proxy`. Mantido como middleware para casar com o site financeiro.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const segredo = process.env.AUTH_SECRET;
  if (!segredoSessaoValido(segredo)) {
    return new NextResponse("Servidor sem AUTH_SECRET válido (ausente, curto ou valor de exemplo)", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const sessao = await verificarSessao(req.cookies.get(COOKIE_SESSAO)?.value, segredo);
  const ehLogin = pathname === "/login";

  if (!sessao) {
    if (ehLogin || rotaPublica(pathname)) return seguir(req, pathname);
    const destino = new URL("/login", req.url);
    // guarda o destino p/ voltar após o login — só navegação de página: mandar
    // alguém de volta a uma rota de arquivo despejaria o arquivo cru na tela
    const alvo = pathname + search;
    if (alvo !== "/" && req.headers.get("sec-fetch-dest") === "document") {
      destino.searchParams.set("next", alvo);
    }
    return NextResponse.redirect(destino);
  }

  if (ehLogin) {
    return NextResponse.redirect(
      new URL(destinoPosLoginParaPapel(req.nextUrl.searchParams.get("next"), sessao.papel), req.url)
    );
  }
  if (rotaPublica(pathname)) return seguir(req, pathname);
  if (pathname === "/") return NextResponse.redirect(new URL(ROTA_INICIAL[sessao.papel], req.url));
  if (!rotaPermitida(sessao.papel, pathname)) return naoEncontrado();

  return seguir(req, pathname);
}

/**
 * 404 do papel sem acesso. Corpo de texto simples de propósito: responder aqui
 * garante que NENHUM código da rota bloqueada chega a rodar (e que a resposta
 * não revela se a rota existe).
 */
function naoEncontrado() {
  return new NextResponse("Não encontrado", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Deixa passar carimbando a rota conferida (o layout raiz exige esse carimbo). */
function seguir(req: NextRequest, pathname: string) {
  const headers = new Headers(req.headers);
  // o carimbo é NOSSO: descarta qualquer x-rota-verificada vindo do cliente
  // antes de gravar o valor do middleware — ninguém forja o carimbo por fora
  headers.delete(HEADER_ROTA);
  headers.set(HEADER_ROTA, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Tudo, exceto os assets internos do Next e os arquivos do app instalável
  // (manifest, service worker e ícones — nenhum contém dado do condomínio; o
  // navegador os busca antes do login, então precisam passar).
  // ATENÇÃO: nunca excluir caminhos com ponto de forma genérica (`.*\..*`):
  // rotas dinâmicas aceitam "12." ou "3.0" e ficariam acessíveis SEM LOGIN por
  // uma URL com ponto (o site financeiro já levou esse furo). Exceções são
  // NOMEADAS uma a uma e ancoradas: `$` impede que "/sw.jsx" ou
  // "/manifest.webmanifest.x" escapem por serem só prefixo do nome liberado.
  matcher: [
    "/((?!_next/static/|_next/image$|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|icons/).*)",
  ],
};
