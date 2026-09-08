# WhatsApp no perfil do cliente

## Templates WhatsApp pelo Sunshine

A navegação lateral maior oferece **Criar templates** para administradores. A listagem e o cadastro usam a integração WhatsApp configurada no Sunshine, com `GET/POST /v1.1/apps/{appId}/integrations/{integrationId}/messageTemplates`. Não exigem login adicional na Meta quando a integração tem acesso de gerenciamento à WABA. O servidor mantém as credenciais fora da interface e valida o administrador Support antes de consultar ou criar.

O formulário oferece texto, categoria utilidade/marketing, idioma, variáveis numéricas, exemplos e prévia. A lista mostra conteúdo e status retornados pelo Sunshine, percorre os cursores e informa que as consultas podem ter cache de duas horas. A resposta de criação aparece imediatamente na lista; só a Meta determina aprovação. Não repetimos automaticamente uma criação com resultado incerto. Cabeçalhos, botões e autenticação ainda não estão implementados no cadastro. Sincronização dos aprovados com o catálogo de envio e grupos continua pendente.

O endpoint local `/templates` requer a conexão do serviço na área Configurar e OAuth Support de administrador. A distribuição multiempresa ainda precisa de autenticação individual e armazenamento por instalação. O fluxo experimental de OAuth Meta permanece no código, mas não é usado por esta tela.

A leitura real da integração Teste foi validada com HTTP 200 e lista vazia. Criação foi validada com API simulada; nenhum template real foi submetido nesta alteração.

Referência: [Sunshine Conversations — WhatsApp Message Templates](https://docs.smooch.io/rest/v1/#whatsapp-message-templates).

Em Customers, abra um perfil e a seção Apps. O app usa `user_sidebar`, lê `user` pelo ZAF e oferece Mensagens, Templates, Contatos e Destinatário. Não tenta ler propriedades de ticket nessa localização.

O histórico percorre os tickets solicitados pelo usuário Support e suas páginas de comentários. Mostra mensagens cujo canal é WhatsApp e notas dos tickets marcados `whatsapp_active_message`. Não agrega perfis apenas por nome ou telefone parecido. Após uma fusão Support, os tickets vinculados ao sobrevivente entram na consulta. Falhas em tickets individuais aparecem como histórico parcial; falha ao listar tickets aparece como erro. Não inclui mensagens não registradas no Support nem interpreta a existência de comentário como prova de entrega/leitura.

## Envio

O ícone WhatsApp no menu superior (`top_bar`) abre um popover de envio. Busque pelo número brasileiro com DDD ou pelo nome de um contato existente. A busca por número inclui os candidatos com/sem nono dígito: se houver resultados, escolha o perfil; não há fusão por semelhança. Se não houver, informe o nome e prossiga para template e variáveis. O botão **Criar contato e enviar** relê o catálogo, repete a busca, cria o usuário Support e registra o ticket antes do disparo. O número é formatado com +55, preservando os dígitos informados.

A busca prévia não garante exclusão mútua entre computadores nem elimina atraso de indexação do Zendesk. Criação com timeout não é repetida automaticamente; pesquise o número antes de preparar outra tentativa. Se o cadastro funcionar e uma etapa posterior falhar, o contato permanece no Support. Não o excluímos automaticamente.

1. O agente escolhe uma macro de template aprovada e confirma valores e consentimento.
2. O app relê contato e macro e cria um ticket com nota interna contendo a instrução e uma cópia do template confirmado.
3. Só depois da resposta de criação do ticket, chama o serviço HTTPS `/send` com seu ID.
4. O serviço consulta o registro no Support, confere o autor real pela auditoria, a lista de agentes autorizados, as restrições da macro e o destinatário Sunshine na integração/portfólio configurados.
5. Reserva o ticket em armazenamento persistente antes da Notifications API. Salva o resultado e adiciona uma nota interna ao ticket.

Contatos vinculados usam o destinatário resolvido em clientes Sunshine ativos, incluindo BSUID. Pelo menu superior, contatos sem vínculo messaging podem receber pelo telefone brasileiro registrado na instrução, desde que ainda corresponda ao perfil. Vínculos pendentes, ambíguos ou inválidos não caem nesse caminho alternativo. A Notifications API pode criar o usuário/conversa Sunshine; isso não garante vínculo automático com o usuário Support previamente criado. Texto e cabeçalhos texto/imagem/documento são aceitos pelo parser atual; formatos avançados continuam pendentes. O ticket de registro não é automaticamente transformado na conversa nativa Sunshine. A correlação/união com um ticket posterior de resposta e os webhooks de entrega/leitura ainda não estão implementados.

## Configuração de teste privado

### Teste com ZCLI

Após `setup:local` e `setup:oauth`, execute `npm run start:local` em um terminal e `npm run dev` em outro. Deixe os parâmetros de instalação em branco no ZCLI. Na seção de envio, cole a chave temporária exibida por `start:local` e clique em **Conectar serviço local**. Essa chave autoriza envios reais, fica somente na sessão do navegador e muda ao reiniciar o serviço. Credenciais Sunshine/Support permanecem no arquivo privado do servidor. Não publique a chave e não exponha essas portas na rede. O servidor aceita somente os origins exatos do ZCLI na porta 4567 e o app compara a conta do serviço com a conta ZAF. As verificações de autor, macro, destinatário e reserva persistente continuam no backend. A conexão usa fetch local sem secure settings; o navegador pode solicitar acesso à rede local. O token OAuth de teste expira e sua renovação ainda é manual via `setup:oauth`.

Execute `npm run setup:local` para abrir o assistente de conexão no endereço com token exibido no terminal. Ele roda apenas em `127.0.0.1:8788`, valida App ID/Key ID/Secret contra o subdomínio informado, percorre as integrações e mostra somente os canais WhatsApp. Confirme o número e informe o portfólio Meta (não inferido do `accountId`, que pode representar a WABA). Ao salvar, grava `~/.zendesk-whatsapp/connection.json` com permissão 0600, fora do repositório. O serviço lê automaticamente esses seis parâmetros; variáveis de ambiente têm precedência. Arquivo protegido por permissões locais, sem criptografia de disco implementada pelo app. Não expor esse assistente na internet: ele é um bootstrap privado de uma conta, não o onboarding multiempresa do Marketplace.

Cliente OAuth, fluxo de autorização Support, grupos de envio, domínio HTTPS e armazenamento protegido por instalação no serviço público continuam pendentes. O assistente não cria tokens Support, não verifica permissões de envio e não dispara mensagens. Uma conexão Sunshine válida não significa que o serviço inteiro esteja pronto.

Histórico e fusão não precisam deste serviço. O envio requer `npm run start:outbound` com:

- `ZENDESK_SUBDOMAIN`, `ZENDESK_OAUTH_TOKEN` para leitura de contatos, macros, auditorias e gravação de notas no Support.
- `SUNSHINE_APP_ID`, `SUNSHINE_KEY_ID`, `SUNSHINE_SECRET`, `WHATSAPP_INTEGRATION_ID`, `META_PORTFOLIO_ID`.
- `OUTBOUND_SERVICE_TOKEN`: segredo aleatório com pelo menos 32 caracteres, exclusivo para autenticar o app neste serviço.
- `OUTBOUND_AGENT_IDS`: IDs dos agentes autorizados, separados por vírgula. O serviço compara com o autor da auditoria do registro, não com um ID enviado pelo navegador.
- `OUTBOUND_DATA_DIR`: diretório persistente privado, fora do repositório, para reservas e resultados.
- `PORT`: opcional; padrão 8787, somente loopback.

Coloque um proxy HTTPS válido diante do serviço. Na instalação privada, configure `outbound_service_host` com seu domínio e `outbound_service_token` com o segredo correspondente. O segredo é interpolado pelo proxy Zendesk e não fica no JavaScript do app. ZCLI não suporta secure settings; o envio precisa de instalação privada para a homologação autenticada. Nenhuma credencial deve entrar no Git.

Esta configuração é para uma conta privada. Não é o onboarding OAuth de Marketplace para múltiplas empresas. A distribuição pública exige finalizar o OAuth de parceiro/global e a gestão de tokens por instalação; não distribuir credenciais particulares de clientes como configuração do Marketplace.

## Falhas e recuperação

Não repetir automaticamente criação de ticket, envio ou nota após resultado incerto. A reserva é persistida com criação exclusiva de arquivo; não é removida após timeout. Se o provedor aceitou mas a nota falhou, o resultado permanece no diretório privado. Revisar o ticket e o resultado antes de preparar outra tentativa. Usar uma única instância do serviço com disco persistente; não usar réplicas com discos separados.

Validado por testes locais com APIs simuladas: contexto Customers, paginação e histórico parcial, registro antes do transporte, restrições de autor/template, resolução BSUID e não repetição. Envio real e recibos ainda não homologados.

Fontes: [User sidebar](https://developer.zendesk.com/api-reference/apps/apps-support-api/user_sidebar/), [Ticket Comments](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/), [Outbound messaging](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/outbound-messaging/), [Secure settings](https://developer.zendesk.com/documentation/apps/app-developer-guide/making-api-requests-from-a-zendesk-app/).
