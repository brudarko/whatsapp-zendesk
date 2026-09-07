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

Não coloque credenciais no repositório. A implementação atual usa apenas a sessão ZAF e as permissões Zendesk do agente. `.zcliignore` exclui dependências e fontes do pacote; `npm run build` gera os arquivos que o app carrega.

## Implementado

- Interface pt-BR com componentes oficiais Zendesk Garden na lateral, editor e navegação.
- Leitura de macros ativas com prefixo `WhatsApp::`, busca e filtro por grupo.
- Cadastro administrativo de **macros de templates já aprovados**, com texto, variáveis estáticas e cabeçalho de texto/imagem/documento. O cadastro não submete nada à Meta.
- Inserção de template no editor, com conferência de ticket, status e canal. O agente revisa e envia pelo Zendesk. Macros com variáveis Zendesk devem ser aplicadas pelo menu nativo para resolver essas variáveis.
- Estimativa da janela de 24h a partir do histórico WhatsApp do usuário final. Não usa comentários de e-mail ou do agente para reabrir a janela.
- Busca de candidatos por telefone, e-mail ou nome; fusão assistida de um usuário final no solicitante atual. Exige revisão explícita na interface e é irreversível.
- Prévia local de áudio. Reprodução do áudio recebido é responsabilidade do player nativo Zendesk.

## Ainda pendente

Primeiro contato via Notifications API, criação/sincronização de templates Meta, formatos avançados, gravação e envio de áudio, confirmação de identidades via webhook/BSUID, fusão automática de perfis e tickets, onboarding completo WABA e publicação no Marketplace. Não existe backend, fila de entregas ou persistência de identidades nesta versão. Não usar em produção como solução completa.

Leia a [pesquisa e arquitetura](docs/pesquisa-e-arquitetura.md), que registra fontes, restrições e o restante do trabalho, e a [investigação de fusão de contatos e BSUID](docs/fusao-contatos-e-bsuid.md). A fusão inicial ainda não possui prévia de perda de campos/notas/tags nem reconciliação de identidades; não está pronta para operação automática. O manifesto continua privado para desenvolvimento; a publicação gratuita ainda não foi realizada.

## Dados e custos

Nenhum dado de clientes é armazenado em servidor próprio nesta versão. O código consulta o Zendesk e só altera macros/perfis quando o usuário executa essas ações no app. A prévia de áudio usa um objeto local no navegador e não faz upload. Não há analytics ou servidor de licenciamento.

O app não cobra licença. Zendesk, Meta e eventual hospedagem têm custos e requisitos próprios.

## Validação desta etapa

Build e seis testes locais passaram. Interface carregada na lateral e no popover do editor no ticket de exemplo do sandbox via ZCLI; solicitante e grupo reais lidos. A janela ficou corretamente desconhecida em um ticket de e-mail, e o catálogo vazio não foi apresentado como conexão WhatsApp validada. Consulta de contatos retornou sem candidatos. Não houve envio de mensagens, cadastro de macros ou fusão de perfis nesta validação.

A lista de canais do sandbox continha apenas um Web Widget ativo. A homologação de WhatsApp depende de conectar uma WABA e número de testes.

`zcli apps:validate` exige autenticação da CLI e ainda não foi concluído. Auditoria de dependências de produção: zero vulnerabilidades reportadas na execução; dependências de desenvolvimento do ZCLI têm alertas que devem ser revisados antes de distribuir o ambiente de desenvolvimento.
