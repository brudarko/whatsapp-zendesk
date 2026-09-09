# Publicação no Marketplace

Estado em 08/09/2026. Cada item aberto diz o que falta e onde.

## Feito

- **Fusão automática é opt-in.** Configuração `auto_merge_contacts` (checkbox, padrão desligado) no `manifest.json`; `api.autoMergeEnabled()` lê `client.metadata()` e `src/app.jsx` só executa a fusão ao abrir o ticket se estiver ligada. Operação irreversível não roda por padrão — é o que a revisão do Zendesk cobra.
- **Pacote de produção sem código de desenvolvimento.** `npm run build` define `LOCAL_SERVICE=false` e o esbuild remove o `fetch` para `127.0.0.1:8787`, o componente de conexão local e a leitura de `sessionStorage`. `npm run build:dev` (usado por `npm run dev`) mantém tudo. Verificado por `grep` no bundle e travado no CI.
- **CI.** `.github/workflows/ci.yml` roda `npm ci`, `npm test`, `npm run build` e falha se o bundle de produção contiver o caminho local.
- **`.env.example`** com as variáveis do serviço, sem valores.

## Bloqueios de infraestrutura

### Credencial do Sunshine: resolvida na instalação

O administrador informa **App ID**, **Key ID** e **Secret key** da Conversations API no formulário de instalação (`manifest.json`); o secret é `secure: true`. O app chama `https://{subdomínio}.zendesk.com/sc/v2/...` por `client.request` com `Authorization: Basic {{basic_auth.token}}` e `basic_auth: { username: <key id>, password: "{{setting.sunshine_secret}}" }` — o proxy do Zendesk concatena, codifica em base64 e substitui o segredo fora do navegador (`src/sunshine.js`).

Testado nesta conta: a mesma rota com o OAuth do agente devolve **HTTP 401**; com o Basic da chave, **200**. Não existe caminho sem credencial.

Com isso, **templates, janela de 24h e recibo de leitura passam a funcionar sem servidor**, e cada instalação usa a sua própria credencial — o bloqueio de multi-tenant deixa de existir para esse caminho. O número do WhatsApp é descoberto pela API (`whatsappIntegration`); só quando a conta tem mais de um o admin precisa preencher `whatsapp_integration_id`, porque o app não escreve nas próprias configurações.

Requisito de plano a declarar na listagem: a página Conversations API exige **Suite Professional ou superior** com Agent Workspace ativo.

Dois pontos a validar na primeira instalação privada:

1. Se o proxy aceita `secure: true` em URL do próprio domínio Zendesk (`/sc`). A doc diz que secure setting não vale para requisição direta à API do Zendesk; se recusar, a alternativa é usar `api.smooch.io`. `domainWhitelist` já cobre `*.zendesk.com`.
2. Se a chave criada pelo admin tem escopo suficiente para ler conversas e participantes.

### O que ainda pede servidor

1. **Falha de entrega.** Só chega por webhook (`conversation:message:delivery:channel|user|failure`), que exige endpoint HTTPS público. Leitura já é consultável (`src/readReceipt.js`).
2. **Autorização de envio fora do browser.** Hoje o app grava a instrução em nota privada e o serviço revalida autor do audit, papel, template e grupo antes de chamar o Sunshine (`server/outbound.mjs`). Se o disparo migrar para o proxy, a credencial fica utilizável por qualquer agente que carregue o app — o controle passa a ser papel/grupo do Zendesk e restrição de grupo da macro. **Decisão pendente.**
3. **Idempotência entre dispositivos.** A reserva exclusiva é um arquivo em disco (`server/index.mjs`, `claim`). Sem servidor, dá para gravar a marca de tentativa no próprio ticket antes de chamar o Sunshine; sobra uma janela em que uma falha real exige abrir novo envio.
4. **Formatos avançados e upload de exemplo** continuam exigindo acesso direto à WABA; pela credencial da instalação, `metaTemplates` reporta `advanced: false`.

## Bloqueios de listagem

- **`manifest.json` com `private: true`.** Virar `false` é o último passo, junto da submissão pelo Developer Portal.
- ~~`zcli apps:validate` e `apps:package`~~ — rodados em 08/09/2026 com o perfil `d3v-brudarko`: **No validation errors**, pacote gerado. O `.zcliignore` precisou excluir `garden-mcp/**`, `.github/**`, `.token-optimizer/**`, `.claude/**`, `.cursor/**` e `.env*`: sem isso o zip saía com 5,3 MB e 3.859 arquivos, levando o `node_modules` de uma ferramenta local. Hoje: 243 KB, só `assets/`, `manifest.json` e `translations/`.
- **Material da listagem:** screenshots, categoria, política de privacidade, contato de suporte, termos. `translations/en.json` já traz nome e descrições em inglês.
- **Interface só em pt-BR.** 253 strings estão cravadas nos arquivos (93 em `src/MetaTemplates.jsx`, 34 em `src/metaTemplate.js`, 28 em `src/templateTypes.js`, o resto espalhado). A listagem em inglês está coberta pelas traduções; a interface respeitar o locale do agente é uma varredura própria, que congela a redação — fazer depois que as telas pararem de mudar.

## Funcional pendente

- **Ativação do vínculo após aprovação da Meta.** O painel de catálogo grava a macro inativa enquanto o template está em análise (`src/MetaTemplates.jsx`) e só ativa quando alguém salva de novo depois da aprovação. Falta reagir ao status.
- **Recibo de leitura implementado por consulta** (`server/readReceipt.mjs`, endpoint `/read`): compara o `lastRead` do participante com a data do registro de envio. **Entrega e falha de entrega continuam impossíveis sem webhook** — o `message` do Sunshine não tem campo de status; `delivery:channel|user|failure` só chega por webhook, que precisa de endpoint público. É hoje a única justificativa de infraestrutura junto da autorização de envio fora do browser.
- Webhooks de identidade, reconciliação com a conversa nativa Sunshine, fila e persistência no serviço, pagamentos. Detalhe em `README.md` e em `docs/pesquisa-e-arquitetura.md`.
- Formatos avançados de template sem homologação real: só o cadastro básico foi aceito (HTTP 201, PENDING).

## Ordem sugerida

1. `zcli login` → `npm run validate` → `npm run package`.
2. Instalar como app privado na conta real e validar os dois pontos da credencial acima.
3. Decidir a autorização de envio: proxy (sem servidor) ou serviço.
4. Varredura de i18n e material da listagem.
5. `private: false` e submissão.
