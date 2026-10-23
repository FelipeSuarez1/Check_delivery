import type { NextConfig } from "next";

/**
 * Origens extras aceitas nas Server Actions, separadas por vírgula no .env
 * (ex.: ORIGENS_PERMITIDAS="encomendas.tangaracondominio.com.br"). O Next
 * compara Origin com Host; atrás de um túnel com domínio novo eles divergem e
 * TODA escrita passa a falhar — o app "lê mas não salva". Declarar aqui evita
 * isso. Preencher ANTES de publicar.
 */
const origensPermitidas = (process.env.ORIGENS_PERMITIDAS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Política de segurança de conteúdo. `unsafe-inline` em script/style é o que o
 * Next e o Tailwind exigem sem nonce. `frame-ancestors 'none'` cobre
 * clickjacking melhor que X-Frame-Options (que fica só como reforço).
 * `blob:` em img-src: pré-visualização das fotos antes do envio e QR.
 * Sem `upgrade-insecure-requests` para não quebrar o acesso local (http).
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 'unsafe-eval' SÓ em desenvolvimento: o React de dev reconstrói stacks com
  // eval. Em produção (next start) a linha não leva essa permissão.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
].join("; ");

const nextConfig: NextConfig = {
  // 22/10/2026: o scaffold veio com `cacheComponents` + `partialPrefetching`.
  // Desligados de propósito: o app é inteiro dinâmico (sessão em cookie e dados
  // do banco em toda tela). O modo exigiria <Suspense> ao redor de cada leitura
  // de cookie/banco e mantém rotas antigas "ocultas" em memória (Activity) — o
  // oposto do que uma lista de encomendas ao vivo precisa.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // até 3 fotos por encomenda (reduzidas no cliente; o servidor ainda
      // aceita o original de até 10 MB cada, caso a redução falhe)
      bodySizeLimit: "32mb",
      ...(origensPermitidas.length > 0 ? { allowedOrigins: origensPermitidas } : {}),
    },
    // O middleware clona e guarda o corpo da requisição; acima de 10 MB (padrão)
    // ele TRUNCA em silêncio e a action recebe um multipart quebrado. Mesmo
    // limite das actions.
    proxyClientMaxBodySize: "32mb",
  },
  turbopack: {
    // existe um package-lock.json perdido em C:\Users\felip; sem a raiz explícita o
    // Next avisa a cada subida. O servidor sempre roda a partir da pasta do projeto.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          // camera=(self): o balcão lê o QR do morador com getUserMedia
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // ignorado em http, então não atrapalha o acesso local sem TLS
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
