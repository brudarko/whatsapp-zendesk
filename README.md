# WhatsApp para Zendesk

App open source, licença Apache 2.0, pensado para o atendimento brasileiro e distribuição gratuita no Marketplace. **Versão inicial em desenvolvimento; ainda não atende ao escopo completo de WhatsApp.**

## Executar

Requer Node.js 20.17+ e uma conta Zendesk habilitada para apps.

```sh
npm ci
npm test
npm run dev
```

O ZCLI serve o app em `http://localhost:4567`. Abra um ticket no ambiente de testes e acrescente `?zcli_apps=true`. Exemplo: `https://d3v-brudarko.zendesk.com/agent/tickets/1?zcli_apps=true`. Clique em Apps na lateral ou no ícone do app no editor. O app também aparece na navegação.

Fluxo de desenvolvimento baseado no [quick start oficial](https://developer.zendesk.com/documentation/apps/getting-started/zendesk-app-quick-start/). O ZCLI requer configuração própria para validar e empacotar, separada da sessão autenticada no navegador:

```sh
npx zcli login
npm run validate
npm run package
```

Não coloque credenciais no repositório. Histórico, macros e fusão Support usam a sessão ZAF e as permissões do agente. O envio direto depende do serviço privado opcional, configurado separadamente. `.zcliignore` exclui dependências, serviço e fontes do pacote; `npm run build` gera os arquivos que o app carrega. Em Customers, abra o perfil do contato com `?zcli_apps=true` e expanda o painel Apps.

## Implementado

- Cadastro e consulta de templates WhatsApp pelo Sunshine, usando o canal conectado ao Zendesk sem login Meta adicional. Formulário de texto com variáveis e exemplos; listagem paginada de conteúdo e status. Criação validada com API simulada e leitura real validada com lista vazia.

- Menu superior com ícone WhatsApp: busca por número/nome, escolha de customer existente ou cadastro automático por nome e telefone ao confirmar template e variáveis. Busca novamente duplicados antes de criar. Primeiro envio por número disponível no serviço para contatos sem vínculo messaging; conflitos de identidade continuam bloqueados.

- [Customers: histórico, envio e fusão](docs/customers-e-envio.md): app no perfil do usuário, histórico WhatsApp entre tickets e revisão de fusão. Fluxo de envio com registro prévio no Support e serviço privado Sunshine implementado; exige configurar/hospedar o serviço e instalar o app privado para usar secure settings. OAuth Marketplace e recibos continuam pendentes.

- Fusão automática Support ao carregar um ticket WhatsApp salvo na lateral, sem backend. Busca candidatos por telefone/e-mail; exige um único candidato e identidade verificada em comum (telefone exato, e-mail ou vínculo messaging). Variações do nono dígito sozinhas não autorizam fusão. Mantém o menor ID; perdas, organizações/permissões diferentes e vínculos Sunshine divergentes ficam para revisão manual. Executa uma verificação por ticket/solicitante por instância do app. `autoLoad` habilitado; requer que o Zendesk carregue o app e permissões de fusão do agente.
- Ícones de navegação e editor monocromáticos preenchidos, seguindo o peso visual da navegação Zendesk.

- [Aba Destinatário e teste sem WABA](docs/bsuid-e-teste-interface.md): dados Support reais e simulações explícitas de BSUID sem telefone, confirmação pendente e conflitos. Resolver e consulta Sunshine por comando local; integração autenticada na interface e envio ainda pendentes.

- Interface pt-BR com componentes oficiais Zendesk Garden na lateral, editor e navegação.
- Leitura de macros ativas com prefixo `WhatsApp::`, busca e filtro por grupo.
- Cadastro administrativo de **macros de templates já aprovados**, com texto, variáveis estáticas e cabeçalho de texto/imagem/documento. O cadastro não submete nada à Meta.
- Inserção de template no editor, com conferência de ticket, status e canal. O agente revisa e envia pelo Zendesk. Macros com variáveis Zendesk devem ser aplicadas pelo menu nativo para resolver essas variáveis.
- Estimativa da janela de 24h a partir do histórico WhatsApp do usuário final. Não usa comentários de e-mail ou do agente para reabrir a janela.
- Busca de candidatos por telefone (incluindo identidades secundárias), e-mail ou nome. Revisão de fusão Support com escolha do perfil principal, vínculos messaging e prévia de perda de notas, detalhes, tags e campos. Exige confirmação explícita; relê os perfis antes da operação e consulta o destino depois. Não executa merge Sunshine.
- Áudio usa os recursos nativos Zendesk; o painel próprio foi removido. Transcrição não implementada.

## Ainda pendente

Sincronização dos templates aprovados com o catálogo de envio, formatos avançados, recibos de entrega/leitura, confirmação de identidades via webhook, reconciliação automática Sunshine e fusão de tickets, onboarding completo WABA e OAuth/publicação no Marketplace. O serviço privado de envio não implementa fila de entregas ou persistência de identidades. Não usar em produção como solução completa.

Leia a [pesquisa e arquitetura](docs/pesquisa-e-arquitetura.md), que registra fontes, restrições e o restante do trabalho, e a [investigação de fusão de contatos e BSUID](docs/fusao-contatos-e-bsuid.md). A fusão agora mostra perdas e vínculos de identidades, mas ainda não reconcilia usuários Sunshine nem automatiza preservação de dados. Não está pronta para operação automática. O manifesto continua privado para desenvolvimento; a publicação gratuita ainda não foi realizada.

## Dados e custos

O serviço opcional armazena IDs de tickets, reservas de tentativa e resultados do envio em diretório privado persistente; a instrução e o contexto ficam em notas privadas no Support. A interface consulta o Zendesk, cria registros de envio e altera macros/perfis nas ações autorizadas, incluindo fusão automática ao abrir tickets elegíveis. Não há analytics ou servidor de licenciamento.

O app não cobra licença. Zendesk, Meta e eventual hospedagem têm custos e requisitos próprios.

## Validação de Customers

26 testes e build locais passaram. O painel foi carregado com dados fictícios e mutações desabilitadas: histórico de dois tickets e bloqueio de envio sem serviço configurado. Testes exercitam registro prévio, validação de agente/template, BSUID e timeout sem repetição. Envio real, recibos e vínculo nativo da conversa continuam sem homologação. Configuração: [Customers e envio](docs/customers-e-envio.md).

## Validação inicial (histórica)

Build e seis testes locais passaram. Interface carregada na lateral e no popover do editor no ticket de exemplo do sandbox via ZCLI; solicitante e grupo reais lidos. A janela ficou corretamente desconhecida em um ticket de e-mail, e o catálogo vazio não foi apresentado como conexão WhatsApp validada. Consulta de contatos retornou sem candidatos. Não houve envio de mensagens, cadastro de macros ou fusão de perfis nesta validação.

A lista de canais do sandbox continha apenas um Web Widget ativo. A homologação de WhatsApp depende de conectar uma WABA e número de testes.

`zcli apps:validate` exige autenticação da CLI e ainda não foi concluído. Auditoria de dependências de produção: zero vulnerabilidades reportadas na execução; dependências de desenvolvimento do ZCLI têm alertas que devem ser revisados antes de distribuir o ambiente de desenvolvimento.

## Revisão de contatos

Testes locais adicionais cobrem perdas, identidades secundárias, perfis inelegíveis, mudança durante a revisão e timeout sem repetição. A interface foi verificada com dados fictícios e mutações desabilitadas: seleção, perdas, duas confirmações e inversão do destino. Não houve merge real. Limite de tickets e demais regras de elegibilidade continuam sujeitos à API Zendesk; ID externo na origem é bloqueado conservadoramente até validar SSO. A releitura reduz conflitos, mas não cria uma transação atômica com a API remota.

## Proteções e teste da fusão automática

A operação relê os perfis e o solicitante antes da fusão. Web Locks serializa as instâncias no mesmo navegador/origem. Um registro local por conta/par de IDs impede nova tentativa automática após timeout ou recarga; se houver tentativa anterior, conferir o resultado manualmente. Armazena apenas IDs e data da tentativa, sem credenciais ou conteúdo de conversas. Sem Web Locks ou acesso ao armazenamento, a fusão automática falha sem escrever na API. Navegadores/computadores diferentes não compartilham esse bloqueio: a releitura e a validação do Zendesk continuam necessárias; não há transação distribuída nem garantia de execução única global.

Esta versão não funde usuários Sunshine nem usa BSUID não consultado como prova. O perfil sem telefone/e-mail não é descoberto por nome na automação; use a busca manual nesse caso. A aprovação da identidade é a registrada no Zendesk, não uma nova verificação de posse do número feita pelo app.

Validação desta alteração: 19 testes e build local. O ticket #3 deixou de estar acessível na sessão do navegador durante a homologação, retornando página inexistente; não foi possível confirmar a nova interface nesse ticket nem executar fusão real. Os testes exercitam a chamada de merge com API simulada e os bloqueios sem mutações reais.

Referências: [ciclo de vida ZAF](https://developer.zendesk.com/api-reference/apps/apps-core-api/core_api/), [autoLoad do manifesto](https://developer.zendesk.com/documentation/apps/app-developer-guide/manifest/).
