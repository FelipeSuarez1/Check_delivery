import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { IBM_Plex_Mono, IBM_Plex_Sans, Sora } from "next/font/google";
import "./globals.css";
import { SessaoProvider } from "@/components/sessao-provider";
import { RegistraSW } from "@/components/registra-sw";
import { estadoDaSessao } from "@/lib/auth";
import { rotaPermitida } from "@/lib/papeis";
import { HEADER_ROTA } from "@/lib/rota-header";
import { sair } from "@/actions/auth";

const titulo = Sora({
  variable: "--font-titulo",
  subsets: ["latin"],
  display: "swap",
});

const texto = IBM_Plex_Sans({
  variable: "--font-texto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const codigo = IBM_Plex_Mono({
  variable: "--font-codigo",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Encomendas Tangará", template: "%s · Encomendas Tangará" },
  description: "Encomendas da portaria do Condomínio Espaço Tangará",
  applicationName: "Encomendas Tangará",
  // app privado (moradores e portaria): fora dos buscadores
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: "Encomendas", statusBarStyle: "default" },
  // iOS < 16.4 só respeita a meta antiga; o Next emite apenas mobile-web-app-capable
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#C47A2C",
  width: "device-width",
  initialScale: 1,
  // área segura (notch / barra de gestos) para a navegação inferior do morador
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Sessão reconferida no banco: um token de 30 dias não basta se a conta foi
  // desativada ou teve a senha trocada no meio do caminho.
  const estado = await estadoDaSessao();
  // Carimbo do middleware = rota que ele conferiu. Sem ele a requisição escapou
  // do porteiro: nada de sessão válida nem de página pública.
  const rota = (await headers()).get(HEADER_ROTA);

  if (estado.estado === "ausente") {
    // Sem sessão só a tela de login é aceitável, e só com o carimbo.
    if (rota === null) notFound();
    if (rota !== "/login") redirect("/login");
  }

  if (estado.estado === "valida") {
    if (rota === null) notFound();
    // Primeiro acesso / senha redefinida pelo admin: só a troca de senha abre.
    // (O middleware é edge e não enxerga o banco; a checagem fica aqui.)
    if (estado.precisaTrocarSenha && rota !== "/conta/senha") redirect("/conta/senha");
    // Defesa em profundidade: o middleware já responde 404 fora da allowlist.
    if (rota !== "/login" && !rotaPermitida(estado.sessao.papel, rota)) notFound();
  }

  const fontes = `${titulo.variable} ${texto.variable} ${codigo.variable}`;

  return (
    <html lang="pt-BR" className={`${fontes} h-full antialiased`}>
      <body className="min-h-dvh">
        {estado.estado === "valida" ? (
          <SessaoProvider papel={estado.sessao.papel} apartamentoId={estado.sessao.apartamentoId ?? null}>
            {children}
          </SessaoProvider>
        ) : estado.estado === "ausente" ? (
          children
        ) : (
          <div className="flex min-h-dvh items-center justify-center px-4">
            <div className="w-full max-w-sm space-y-3 rounded-2xl border border-line bg-card p-6 text-center">
              <h1 className="text-lg">
                {estado.estado === "inativa" ? "Acesso desativado" : "Sessão encerrada"}
              </h1>
              <p className="text-sm text-ink-2">
                {estado.estado === "inativa"
                  ? "Sua conta foi desativada. Fale com o síndico para reativá-la."
                  : "Sua senha foi alterada ou o acesso expirou. Entre de novo para continuar."}
              </p>
              <form action={sair}>
                <button
                  type="submit"
                  className="inline-flex h-12 w-full items-center justify-center rounded-[10px] border border-line bg-card px-4 font-semibold hover:bg-muted"
                >
                  {estado.estado === "inativa" ? "Sair" : "Ir para o login"}
                </button>
              </form>
            </div>
          </div>
        )}
        <RegistraSW />
      </body>
    </html>
  );
}
