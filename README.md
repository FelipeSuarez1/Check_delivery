# Encomendas Tangará

Controle de encomendas da portaria do Condomínio Espaço Tangará (PWA). O porteiro
registra cada volume com foto e apartamento, o sistema gera um código de 4
caracteres e os moradores veem as encomendas do apartamento no celular.
Contrato do projeto (decisões, modelo, papéis, segurança): [`CLAUDE.md`](CLAUDE.md).
Plano técnico: [`docs/plano.md`](docs/plano.md).

## Como rodar

```bash
npm install
cp .env.example .env            # edite: AUTH_SECRET longo e aleatório (>= 32 caracteres)
npx prisma migrate dev          # cria/atualiza prisma/dev.db
npx tsx scripts/importa-cadastro.ts            # simulação (dados/apartamentos.csv e moradores.csv)
npx tsx scripts/importa-cadastro.ts --aplicar  # grava (52 apartamentos, 95 moradores)
npx tsx scripts/cria-usuarios.ts               # felipe, achilles, portaria e 1 login por apto (apNNa)
npm run dev                     # http://localhost:3001
```

`.env`: `DATABASE_URL`, `AUTH_SECRET` e, ao publicar, `ORIGENS_PERMITIDAS`
(domínio público, sem isso as Server Actions falham atrás do túnel).

## Usuários e senhas

- `scripts/cria-usuarios.ts` cria os logins que faltam, cada um com **senha inicial
  aleatória própria**, e grava todas em `dados/senhas-iniciais-AAAA-MM-DD.txt`
  (texto puro, fora do git). **Entregue e apague o arquivo** — a pasta fica no OneDrive.
  Todos entram com `precisaTrocarSenha`: no primeiro acesso o app obriga a escolher a
  própria senha.
- `--resetar` reemite a senha de quem ainda não trocou a sua; `--resetar=ap11a,portaria`
  reemite logins específicos; `--resetar --todos` reemite todos (derruba quem já trocou).
- Contas de teste (um por papel): `npx tsx scripts/cria-usuarios-teste.ts <senha>`
  (`admin-teste`, `portaria-teste`, `morador-teste` do apto 11A) e `--remover` ao terminar.

## Validação

```bash
npx tsc --noEmit
npx prisma migrate status
# com o site no ar e uma conta de teste:
LOGIN_USUARIO=portaria-teste LOGIN_SENHA=... VIEWPORT=1180x820 npx tsx scripts/screenshot.ts tmp/shots /portaria
LOGIN_USUARIO=morador-teste  LOGIN_SENHA=... VIEWPORT=390x844  npx tsx scripts/screenshot.ts tmp/shots /app
```

## Produção

`npm run build && npm run start` (porta 3001). PWA: `scripts/gera-icones-pwa.ts`
regenera `public/icons/`. Operação (túnel, backup, retenção de fotos): `CLAUDE.md` §9.
