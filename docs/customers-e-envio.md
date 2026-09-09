# WhatsApp no perfil do cliente

## Templates WhatsApp pelo Sunshine

A navegação lateral maior (`nav_bar`) oferece **Gerenciar templates** para administradores. O editor não aparece no ticket, no perfil do contato ou no menu superior. A interface usa componentes Zendesk Garden: catálogo com busca/status, escolha do tipo por categoria, conteúdo com prévia e revisão antes de submeter.

Texto, cabeçalho de texto, rodapé e botões básicos usam `GET/POST /v1.1/apps/{appId}/integrations/{integrationId}/messageTemplates` do Sunshine. O servidor mantém as credenciais fora da interface e valida o administrador Support. A listagem percorre os cursores e pode refletir cache de duas horas. A resposta de criação aparece imediatamente; só a Meta determina aprovação. Não repetimos automaticamente uma criação com resultado incerto.

O editor também prepara mídia, variáveis com nomes, autenticação, localização, Flows, cupons, ofertas limitadas, carrosséis, produtos/catálogos e chamadas. Esses caminhos usam gerenciamento direto da Meta e ficam bloqueados para submissão quando essa conexão não está configurada para a **mesma WABA** do canal Sunshine. Upload de exemplos usa Resumable Upload; uma URL de imagem não substitui o handle exigido pela Meta. Há limite local de 5 MB por imagem e 16 MB por vídeo/PDF.

Pedido/pagamento, status de pedido e checkout são apenas opções informativas com acesso ao Gerenciador do WhatsApp: a criação desses formatos **não está implementada**. Sua disponibilidade regional e habilitação precisam ser validadas. A matriz completa e as fontes estão em [Experiência de templates](template-experience.md).

Os endpoints locais `/templates`, `/templates/capabilities` e `/templates/media` requerem a conexão do serviço na área Configurar e OAuth Support de administrador. A distribuição multiempresa ainda precisa de autenticação individual e armazenamento por instalação. Gerenciamento avançado usa `META_ACCESS_TOKEN`, `META_WABA_ID`, `META_GRAPH_VERSION` e, para upload, `META_APP_ID`, mantidos no serviço. A indicação de configuração não comprova validade/permissões do token; a operação ainda pode ser recusada pela Meta.

Leitura real Sunshine validada com HTTP 200. Em 08/09/2026, o template `teste_teste` (utilidade, pt_BR, cabeçalho/texto/rodapé/resposta rápida) foi criado pela API Sunshine com HTTP 201, ID `1014352004980411`, status `PENDING`. A tentativa da interface havia retornado HTTP 400 sem detalhe; a repetição com os campos visíveis foi aceita, mas isso não comprova a causa da recusa original. Upload e formatos avançados continuam validados apenas com APIs simuladas. Sincronização com o catálogo de envio e atribuição a grupos continuam pendentes.

Referência: [Sunshine Conversations — WhatsApp Message Templates](https://docs.smooch.io/rest/v1/#whatsapp-message-templates).

## Perfil do contato

A aba Duplicados inicia com **Procurar duplicados**. A busca combina telefone (incluindo variantes brasileiras), e-mail e nome, elimina resultados repetidos e informa consultas parciais. Cada candidato leva à revisão dos dois perfis, escolha do principal e confirmação de fusão. Detalhes técnicos ficam recolhidos; bloqueios e perdas de dados continuam explícitos. Encontrar um candidato nunca executa a fusão automaticamente.

No Customers, as áreas **Enviar**, **Histórico**, **Templates** e **Duplicados** ficam separadas. Nome e telefone formatado aparecem uma única vez. Enviar concentra seleção do template, variáveis, prévia e ação; sem catálogo, mostra apenas orientação e acesso aos templates.

O histórico é consultado ao abrir sua aba, com atualização própria, filtro de conversas/registros e mensagens longas recolhidas. Consulta parcial e falhas continuam visíveis. O formulário e a proteção após uma tentativa permanecem ao trocar de aba, mas rascunhos não são persistidos ao recarregar o app.

Revisão baseada na captura e no relato do usuário, sem entrevistas com agentes. Inspeção em prévia local de 380 px validou troca de abas, preservação de variável, filtro, estado vazio e bloqueio após envio simulado; não realizou envio real.

## Envio

O ícone WhatsApp no menu superior (`top_bar`) abre um popover de envio. Há um único campo de busca: o critério é o próprio texto — dígitos, espaços, parênteses, hífen ou `+` viram busca por número (com o seletor de DDI ao lado); qualquer outra coisa vira busca por nome. Só entram nos resultados contatos com telefone, do tipo end-user e não suspensos, porque o envio ativo depende do número; os demais não aparecem em vez de aparecer indisponíveis. A busca por número inclui os candidatos com/sem nono dígito: se houver resultados, escolha o perfil; não há fusão por semelhança. Se não houver, informe o nome e prossiga para template e variáveis. O botão **Criar contato e enviar** relê o catálogo, repete a busca, cria o usuário Support e registra o ticket antes do disparo. O número é formatado com +55, preservando os dígitos informados. Na exibição, números brasileiros são agrupados como `+55 (49) 9946-5530` — inclusive os legados de oito dígitos, que o libphonenumber trata como inválidos e deixaria sem agrupamento; nenhum DDI ou nono dígito é inventado para exibir.

A busca prévia não garante exclusão mútua entre computadores nem elimina atraso de indexação do Zendesk. Criação com timeout não é repetida automaticamente; pesquise o número antes de preparar outra tentativa. Se o cadastro funcionar e uma etapa posterior falhar, o contato permanece no Support. Não o excluímos automaticamente.

1. O agente escolhe uma macro de template aprovada e confirma valores e consentimento.
2. O app relê contato e macro e cria um ticket com nota interna contendo a instrução e uma cópia do template confirmado.
3. Só depois da resposta de criação do ticket, chama o serviço HTTPS `/send` com seu ID.
4. O serviço consulta o registro no Support, confere o autor real pela auditoria, a lista de agentes autorizados, as restrições da macro e o destinatário Sunshine na integração/portfólio configurados.
5. Reserva o ticket em armazenamento persistente antes da Notifications API. Salva o resultado e adiciona uma nota interna ao ticket.

Contatos vinculados usam o destinatário resolvido em clientes Sunshine ativos, incluindo BSUID. Pelo menu superior, contatos sem vínculo messaging podem receber pelo telefone brasileiro registrado na instrução, desde que ainda corresponda ao perfil. Vínculos pendentes, ambíguos ou inválidos não caem nesse caminho alternativo. A Notifications API pode criar o usuário/conversa Sunshine; isso não garante vínculo automático com o usuário Support previamente criado. Texto e cabeçalhos texto/imagem/documento são aceitos pelo parser atual; formatos avançados continuam pendentes. O ticket de registro não é automaticamente transformado na conversa nativa Sunshine. A correlação/união com um ticket posterior de resposta ainda não está implementada. **Leitura** é consultável sob demanda: o app pede `/read` ao serviço, que resolve as conversas do contato e compara o `lastRead` do participante (Sunshine: "latest message the user has read") com a data do registro de envio; leitura anterior ao envio é de outra mensagem e não conta. **Entrega não é consultável**: o objeto `message` do Sunshine não tem campo de status e `conversation:message:delivery:channel|user|failure` só existe como webhook, que exige endpoint público. A interface mostra "Lido em …" quando confirma e, fora disso, diz que não há confirmação — nunca afirma entrega.

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

## Janela de atendimento WhatsApp

A tela apresenta horas e minutos restantes desde a última mensagem recebida do cliente, incluindo resposta a uma mensagem ativa. Cada nova mensagem do cliente renova as 24h; abertura do ticket, entrega/leitura ou envio do agente não renovam o prazo.

O serviço local `/window` resolve o solicitante do ticket no Support e seus vínculos messaging. Consulta conversas e mensagens pela API Sunshine v2, filtrando autor, canal WhatsApp e integração configurada. Prefere `source.originalMessageTimestamp` a `received`. As páginas são percorridas nas direções indicadas pela API, reconstruindo os caminhos localmente. A consulta tem limite de 30 páginas; histórico incompleto não é apresentado como confirmado. Sem confirmação Sunshine, a tela identifica a estimativa pelo ticket na explicação do cálculo. A fonte é atualizada a cada minuto e nos eventos de conversa; o contador visual acompanha o relógio local.

Em 08/09/2026, GETs reais ao Sunshine e POST local de consulta `/window` para o ticket 6 retornaram uma janela aberta, com `lastInbound=1788892804000`. Nenhuma mensagem foi enviada. Testes cobrem paginação, mensagens de outro canal/integrante, limite exato de 24h e ausência de dados.

Fontes: [regra de 24h do WhatsApp](https://docs.smooch.io/guide/whatsapp/#whatsapp-message-templates), [especificação Sunshine v2](https://github.com/zendesk/sunshine-conversations-api-spec/blob/master/openapi.yaml).
