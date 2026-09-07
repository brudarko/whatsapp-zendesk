# WhatsApp para Zendesk — pesquisa e decisões

Consulta: 7 de setembro de 2026. Este documento distingue capacidades documentadas, proposta do produto e código implementado. Não representa homologação de entrega em WhatsApp. A investigação detalhada posterior de identidade, perdas de dados e BSUID está em [Fusão de contatos e BSUID](fusao-contatos-e-bsuid.md), com 43 cenários e lacunas do código atual.

## O que mudou no Zendesk

O Zendesk já tem mecanismos para mensagens ativas. O [Relay, do Zendesk Labs](https://support.zendesk.com/hc/en-us/articles/7051551958426-Installing-and-using-the-Relay-messaging-app), faz campanhas e gerencia templates, mas a documentação registra limitações no cadastro de autenticação e cabeçalhos de mídia. A oportunidade do projeto é uma operação individual integrada ao ticket, identidade brasileira, permissões por grupo e formatos mais completos. Não precisamos recriar o produto inteiro de campanhas.

A [reprodução de áudio foi anunciada em maio de 2026](https://support.zendesk.com/hc/en-us/articles/10585858176794-Announcing-audio-playback-in-messaging-conversations). Aproveitar o player nativo. Gravar e enviar precisa de validação separada; a existência de playback não comprova um gravador nativo.

Na inspeção do sandbox, o compositor do ticket de e-mail também mostrou um botão “Record a voice message”. Isso é evidência de disponibilidade desse controle nessa tela, não comprova origem nativa, disponibilidade no WhatsApp ou entrega de voz. Não foi ativado o microfone. Investigar antes de duplicar um gravador existente.

As [novidades de fevereiro de 2026](https://support.zendesk.com/hc/en-us/articles/10231895896090-What-s-new-in-Zendesk-February-2026) incluem gatilhos de messaging para canais sociais. Avaliar regras nativas para tarefas de roteamento antes de implementá-las no app.

O [fluxo oficial de mensagens proativas](https://support.zendesk.com/hc/en-us/articles/9586188841626-Workflow-How-to-proactively-contact-users-on-WhatsApp-channel) distingue retomar um contato existente por template e fazer o primeiro contato via Notifications API. A documentação exige Suite Professional ou superior para a Conversations API. Confirmar as capacidades da conta, não inferir pelo acesso ao app. Gratuidade no Marketplace não elimina tarifas Meta, plano Zendesk ou hospedagem.

A [migração para BSUID](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/whatsapp-bsuid-migration/) muda a modelagem: `externalId` de um cliente WhatsApp pode ser um identificador opaco, com telefone opcional em `additionalIdentifiers`. Identidade precisa incluir o portfólio da empresa; o mesmo BSUID não deve ser reaproveitado entre portfólios. Também há falhas de matching antes da criação de uma conversa. Implementar tratamento distinto de falha de entrega. O anúncio prevê testes regionais em 30 de junho de 2026 e disponibilidade geral em agosto de 2026; esse cronograma não confirma rollout completo na conta. Ver fontes e detalhes na investigação de fusão vinculada acima.

## Fluxo proposto

1. Agente abre o ticket ou a ação na barra do editor.
2. App resolve conta, marca, integração WhatsApp, usuário de conversas e destinatário confirmado.
3. Procura possíveis duplicados por telefone e outros identificadores. Nome e telefone são indícios, não identidade comprovada.
4. Mostra templates autorizados para o agente/grupo, idioma, categoria e status atual retornado pela Meta.
5. Agente preenche variáveis e mídias, vê a prévia e confirma o destinatário.
6. Antes de enviar, persistir a tentativa e confirmar seu registro no ticket do atendimento; criar ticket se ainda não existir. Transporte usa conversa existente quando possível. Primeiro contato usa Notifications API ou Create Client, conforme vínculo pretendido.
7. Webhooks reconciliam aceitação, entrega, leitura, falhas, identidade e ticket. Enviar template não reabre a janela: a resposta do cliente reabre.
8. Caso surja ticket duplicado, a reconciliação avalia se a fusão mantém o atendimento correto. Nunca fundir todos os tickets do mesmo telefone.

## Envios do contato e registro imediato no ticket

Requisito confirmado em 07/09/2026: toda tentativa de envio confirmada pelo agente deve ficar registrada no atendimento antes do disparo, independentemente de entrega, leitura ou resposta. A seção **Envios** deve mostrar o histórico do contato, incluindo tentativas com falha. Esta seção e seu processamento ainda não estão implementados.

### Experiência

- No ticket, abrir Envios já filtrado pelo contato, com indicação do ticket de cada envio. Permitir restringir ao atendimento atual.
- Mostrar conteúdo efetivamente enviado, template/idioma e valores utilizados, mídia referenciada, número empresarial, destinatário, agente/grupo, data/hora, estado e link do ticket. Guardar uma fotografia do conteúdo: editar o template depois não deve mudar o histórico.
- Filtros por período, situação e número empresarial. Detalhe de cada tentativa com linha do tempo e motivo compreensível de falha.
- Resposta do contato é uma ocorrência separada de entrega/leitura; não atribuir uma resposta genérica a um template específico sem correlação.
- Sem evento de leitura, exibir “Leitura não confirmada”; não afirmar “Não lida”. Ausência de webhook também não prova falha nem bloqueio.

| Estado | Evidência necessária |
| --- | --- |
| Registrada / aguardando envio | Tentativa persistida e registro no ticket confirmado |
| Em processamento | Transporte iniciado, sem confirmação de aceitação pelo canal |
| Aceita pelo WhatsApp | Confirmação de aceitação pelo canal; não é entrega ao aparelho |
| Entregue | Evento de entrega ao destinatário |
| Lida | Confirmação de leitura aplicável à mensagem e ao destinatário |
| Falhou | Rejeição confirmada, com etapa e motivo registrados |
| Confirmação pendente | Resultado ambíguo; reconciliar antes de repetir o envio |

Os [eventos oficiais de entrega](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/delivery-events/) distinguem aceitação pelo canal, entrega ao usuário e falha. Para leitura, consumir o evento de leitura suportado pela integração e validar seu alcance por mensagem/conversa; nunca marcar toda a conversa como lida indiscriminadamente. Confirmar payloads reais na WABA antes de habilitar o indicador.

### Ticket desde o início

1. Validar permissões, destinatário, template e atendimento escolhido antes de aceitar a solicitação.
2. Persistir uma tentativa com identificador único. Registrar uma nota interna no ticket existente, se editável e pertencente ao atendimento; se não houver, criar um ticket com o contato como solicitante. A nota inicial descreve uma tentativa, não uma mensagem já enviada.
3. Confirmar o ticket e o comentário antes de chamar o transporte. Se a criação falhar ou tiver resultado ambíguo, não enviar: reconciliar primeiro. Revisar gatilhos do tenant para evitar notificações involuntárias.
4. Enviar uma única vez e associar os IDs retornados da notificação, conversa e mensagem à tentativa. Uma resposta HTTP bem-sucedida não comprova entrega ao contato.
5. Processar webhooks mesmo com o navegador fechado. Atualizar a seção Envios e acrescentar notas internas dos marcos confirmados no ticket, sem reenviar o conteúdo ao WhatsApp. Comentários são registros adicionais, não presumir que podem ser editados.
6. Preservar tentativas com falha, eventos atrasados e resultado desconhecido. Novo envio deliberado é outra tentativa vinculada à anterior, não sobrescrita do histórico.

O [Zendesk documenta a criação de tickets de notificações](https://support.zendesk.com/hc/en-us/articles/9970596791834-How-can-I-transform-outbound-messages-into-Zendesk-tickets) usando eventos `notification:delivery:user`/`notification:delivery:failure` e transferência para o Agent Workspace. Isso permite um ticket sem resposta do usuário, mas esperar esses eventos não atende ao registro prévio exigido aqui. Na [migração BSUID](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/whatsapp-bsuid-migration/), algumas falhas de matching sequer criam uma conversa; o registro Support precisa sobreviver independentemente dela.

**Limite a homologar:** criar um ticket pela API Support não o transforma automaticamente em ticket WhatsApp vinculado à conversa Sunshine. O [passControl](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/switchboard/) oferece integração nativa com o Agent Workspace, mas não assumir que vincula um ticket arbitrário preexistente. Validar o vínculo e a eventual reconciliação do ticket nativo sem perder o registro inicial. Essa questão é separada da fusão de contatos.

### Garantias e critérios de aceite

- Persistência por conta e autorização no backend: um agente só consulta envios dos contatos/atendimentos que pode acessar. Não guardar o histórico exclusivamente no iframe ou localStorage.
- Deduplicar cliques, solicitações e eventos; serializar por tentativa. Não presumir idempotência do POST de tickets ou do transporte e não repetir um envio após timeout sem reconciliação.
- Validar autenticidade dos webhooks conforme a API usada e correlacionar conta, integração, destinatário e IDs. Eventos desconhecidos aguardam correlação; não anexar por telefone apenas.
- Preservar horários dos eventos e recebimento; eventos fora de ordem não rebaixam uma leitura confirmada a “enviada”. Falhas parciais de mensagens com múltiplas partes devem permanecer visíveis.
- Separar falha de entrega de falha ao gravar a atualização no ticket. Repetir a gravação do histórico não pode reenviar WhatsApp.
- Homologar: contato que nunca responde; aparelho offline; rejeição imediata; falha de matching sem conversa; recibo de leitura ausente; webhooks repetidos/fora de ordem; dois cliques/agentes; timeout de criação/envio; fechamento do navegador; ticket fechado enquanto aguarda recibos; fusão do contato durante o envio; resposta posterior com contexto preservado.
- Se o ticket já estiver fechado quando chegar um recibo, manter o evento no histórico durável e mostrar a pendência de registro no ticket. Não prometer comentário em ticket fechado nem criar outro silenciosamente.

## Identidade brasileira e fusão

A [Anatel documenta a adoção do nono dígito](https://www.gov.br/anatel/pt-br/regulado/numeracao/codigos-nacionais/nono-digito). Isso explica a normalização telefônica, mas não comprova que dois registros Zendesk pertencem à mesma pessoa hoje.

Manter o valor original e gerar candidatos E.164. Tratar DDD 55 sem confundi-lo com DDI 55. Não normalizar números internacionais ou BSUID como brasileiros. Não inserir 9 em fixos ou serviço de rádio. A heurística inicial cobre números legados iniciados por 8/9 e deixa casos ambíguos para busca manual; ela não pretende cobrir toda a numeração histórica.

O [Advanced End User Merge](https://www.zendesk.com/marketplace//apps/support/1162551/advanced-end-user-merge/) oferece busca por nome, e-mail e telefone, revisão dos candidatos, seleção do perfil principal e fusão. O comportamento publicado é assistido, não uma autorização para fundir silenciosamente por semelhança.

Política pretendida: fusão automática somente após a integração confirmar vínculo estável da identidade, sem conflito de dados, com política explícita do administrador. Guardar IDs de origem/destino, evidência, ator, data e resultado. Revalidar antes da mutação; serializar por identidade e não repetir uma fusão parcialmente concluída. Telefones reciclados, linhas compartilhadas e perfis com identidades divergentes exigem revisão. O código inicial tem apenas fusão assistida para um candidato por vez, preservando o solicitante atual.

As APIs de [fusão de usuários](https://developer.zendesk.com/api-reference/ticketing/users/users/) e [fusão de tickets](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/) são distintas. Ticket merge é assíncrono: acompanhar `job_status` e verificar resultados individuais. Conferir marca, identidade, integração, estado do ticket e vínculo da notificação. Fechar um ticket não significa migrar a conversa Sunshine; isso precisa ser homologado. Não tratar o retorno HTTP inicial como fusão concluída.

## Templates e formatos

| Família | Caminho a implementar / validar |
| --- | --- |
| Texto, variáveis, cabeçalho de texto | Cadastro Meta, amostras, sincronização de aprovação e envio estruturado |
| Imagem, vídeo, documento | Upload de amostra e referência de mídia para envio; validar MIME, tamanho e expiração |
| Rodapé e botões | Resposta rápida, URL estática/dinâmica, telefone e demais subtipos documentados na versão Meta escolhida |
| Autenticação | Fluxo próprio e capacidades da WABA; não tratar como template genérico |
| Carrossel, catálogo/produtos, Flows e outros formatos avançados | Matriz explícita Meta × Sunshine × Agent Workspace antes de habilitar |
| Áudio | Mensagem de mídia dentro da janela; não um template genérico de reabertura |

Esta tabela é um backlog de compatibilidade, não declaração de suporte confirmado a todos esses formatos. A documentação Meta consultada não ficou acessível nesta sessão, portanto os detalhes de formatos, permissões, limites e onboarding precisam de confirmação em fonte primária antes da implementação. Não fixar números máximos, versões Graph ou prometer paridade universal por inferência.

A [sintaxe shorthand oficial](https://developer.zendesk.com/documentation/conversations/references/shorthand-syntax/) permite templates dentro de mensagens de texto. A primeira versão usa esse caminho para modelos existentes. Não inferir aprovação a partir da existência de uma macro. O cadastro inicial pede conferência explícita do administrador e não faz chamada de submissão Meta.

O [envio outbound](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/outbound-messaging/) permite `messageSchema: whatsapp` para reconstrução de templates. A escolha entre Notifications API e Create Client deve considerar em qual usuário/conversa o histórico precisa ficar. Não assumir que todo reengajamento cria obrigatoriamente novo ticket; reproduzir isso no sandbox.

## Arquitetura e experiência nativa

- ZAF 2.0 nas localizações `ticket_sidebar`, `ticket_editor` e `nav_bar`.
- React e componentes oficiais Zendesk Garden; campos, botões, foco por teclado e idioma pt-BR.
- API Support pelo ZAF com sessão/permissões do agente. Nenhum token no frontend ou localStorage.
- Primeira versão reutiliza macros e restrições por grupo. Isso fornece persistência compartilhada nativa, sem banco novo, para o catálogo básico.
- Para escopo completo: serviço de integração auto-hospedável por conta, armazenamento de configuração/identidade/entregas, fila durável e webhooks. Definir hospedagem com o mantenedor antes de expor endpoints públicos. Segredos fora do iframe, escopos mínimos, validação de assinatura/audiência/tenant e RBAC no serviço; não confiar em group IDs enviados pelo navegador.
- O assistente WABA deve começar pelo canal nativo Zendesk. Embedded Signup próprio depende de configuração e requisitos do aplicativo Meta; não prometer um botão que contorna verificações do provedor.

O [ticket editor](https://developer.zendesk.com/api-reference/apps/apps-support-api/ticket_editor/) oferece uma ação suportada na barra, sem injetar DOM do Zendesk. Respeitar o popover de até 320 px de altura. O app pode inserir texto no editor; não substituir o compositor inteiro.

Para a janela, usar timestamp original do último inbound WhatsApp, associado à integração. O `ticket.conversation` do [ZAF](https://developer.zendesk.com/api-reference/apps/apps-support-api/ticket_sidebar/) é útil para uma estimativa visual; ausência de histórico deve aparecer como desconhecido, nunca como janela aberta. A primeira versão não usa essa estimativa para autorizar envio de mídia.

## O que existe no código inicial

- Build com esbuild, ZCLI, três localizações, componentes Garden e mensagens pt-BR.
- Busca de macros WhatsApp, filtro por grupo, cadastro de macro de texto/imagem/documento e inserção no editor.
- Busca assistida de contatos por telefone/e-mail/nome e fusão de um perfil em outro mediante revisão no app.
- Estimativa da janela com base apenas em mensagens WhatsApp de usuários finais.
- Prévia local de áudio; playback recebido fica com o Zendesk.
- Testes das regras e proteção de entradas. Nada foi enviado a clientes ou fundido durante o desenvolvimento.

Ainda não implementados: Notifications API, submissão/sincronização Meta, todos os formatos, variáveis dinâmicas resolvidas pelo app, gravador/envio de áudio, BSUID reconciliado por webhook, fusão automática de usuários e tickets, Embedded Signup próprio e publicação no Marketplace. O objetivo completo permanece aberto.

## Homologação antes de publicação

Estado observado no sandbox `d3v-brudarko`: sessão administrativa autenticada, ticket de exemplo de e-mail e apenas um Web Widget ativo na lista de canais. Não havia canal WhatsApp listado. App local carregado via ZCLI na lateral e no popover do editor; leitura de solicitante/grupo e consulta sem candidatos verificadas. Build e seis testes passaram. Validação oficial do pacote pendente de login próprio da CLI. Nenhuma mensagem, macro ou fusão foi executada nessa homologação inicial.

Testar no sandbox: texto/mídia em janela aberta; template depois de 24h; primeiro contato com consentimento; resposta e ticket resultante; variáveis e idiomas; template suspenso; falhas 401/403/429 e timeout sem duplicar envios; dois agentes enviando ao mesmo contato; números com/sem 9 e BSUID sem telefone; merge com dados conflitantes; áudio real em navegadores suportados; acesso por grupos; instalação por pessoa sem experiência técnica.

Publicar apenas depois de README de instalação, licença, política de dados/retenção, suporte, ícones definitivos e revisão Marketplace. O manifesto permanece privado para desenvolvimento.

## Atualização de escopo e implementação

Gravação/envio/playback próprios saíram do escopo por decisão do usuário; painel de áudio removido. Recursos nativos anunciados em 2026 devem ser usados. Transcrição local foi discutida, mas não aprovada como implementação. A revisão de contatos agora inclui identidades, prévia de perdas, escolha do destino e revalidação; consultar a atualização em `fusao-contatos-e-bsuid.md`. Descrições anteriores do código inicial são históricas. O serviço de envio/webhooks e merge Sunshine ainda não existem.
