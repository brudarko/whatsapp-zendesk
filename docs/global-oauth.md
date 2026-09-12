# OAuth global — Portta

Backend de OAuth de produção que substitui o assistente local (`server/oauth.mjs`,
callback em `localhost`, uma única conta). Necessário para publicar o app no
Marketplace do Zendesk.

## Dados definidos

- Identificador do cliente: `zdg-whatsapp-connector-brl`
- Nome de exibição sugerido: `Portta WhatsApp Connector`
- Domínio compartilhado entre apps: `apps.portta.com.br` (DNS no Registro.br, CNAME → Vercel)
- Callback deste app: `https://apps.portta.com.br/whatsapp/oauth/callback`
- Escopos mínimos: `users:read users:write tickets:read tickets:write`

## Backend (repositório `portta`)

Implementado em `../portta` (Vercel, Express zero-config). Ver `portta/README.md`.

- `src/whatsapp-oauth.mjs` — fluxo OAuth com PKCE + `state`, cofre de tokens
  criptografado (AES-256-GCM), armazenamento em Postgres (states, connections,
  sessions), renovação automática de token, reverificação de admin e desconexão.
  Os tokens nunca chegam ao navegador.
- `sql/001-whatsapp-oauth.sql` + `scripts/migrate.mjs` — schema e runner idempotente.
- Variáveis de ambiente (na Vercel): `DATABASE_URL`, `ZENDESK_CLIENT_SECRET`,
  `OAUTH_ENCRYPTION_KEY` (32 bytes base64, estável).
- 3 testes cobrindo tenant/host, criptografia autenticada e o fluxo completo
  (bind browser/state, callback consumido uma vez, tokens server-side, refresh,
  troca de admin, disconnect). Rodar com `npm test`.

Estado: código pronto para deploy. Falta provisionar Postgres, configurar as
variáveis na Vercel, publicar em `apps.portta.com.br`, rodar a migração e validar
o fluxo real ponta a ponta.

## Checklist para solicitar o OAuth global

1. **Publicar o serviço**
   - Provisionar Postgres e definir as três variáveis na Vercel.
   - Apontar `apps.portta.com.br` (CNAME) para o projeto Vercel e aguardar o TLS.
   - Deploy e `DATABASE_URL=... npm run migrate` uma vez no banco de produção.
   - Conferir `https://apps.portta.com.br/healthz` e `.../whatsapp`.
2. **Criar o cliente OAuth** na conta patrocinada `d3v-`, com o identificador
   `zdg-whatsapp-connector-brl`, o callback de produção e todos os campos preenchidos.
   Guardar o `ZENDESK_CLIENT_SECRET` só na Vercel.
3. **Validar o fluxo completo** (conectar → callback → conexão → desconectar) com
   um administrador real do Zendesk, usando o backend publicado.
4. **Solicitar a conversão** para OAuth global no portal do Marketplace (Global OAuth).
   A aprovação e a conversão são feitas pela Zendesk.
5. **Apontar o app ZAF** para o backend de produção (trocar o fluxo localhost pelo
   callback HTTPS e usar secure settings) — etapa seguinte, fora deste documento.

Referência: https://developer.zendesk.com/documentation/marketplace/building-a-marketplace-app/set-up-a-global-oauth-client/
