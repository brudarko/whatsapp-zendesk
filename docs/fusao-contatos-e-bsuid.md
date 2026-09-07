# Fusão de contatos, identidades e tickets

Pesquisa e revisão do código: 7 de setembro de 2026. Matriz de cenários relevantes ao projeto, não garantia de exaustividade da plataforma. Comportamentos dependentes de configuração/rollout precisam de homologação. Nenhuma fusão real foi executada.

## Resposta sobre a implementação

Existe `mergeUser(sourceId, targetId)` em `src/zendesk.js`, chamado pela tela Contatos. Ele relê os dois usuários, rejeita mesmo ID, agentes/admins e suspensos e chama `PUT /api/v2/users/{origem}/merge`, preservando o solicitante atual. A tela exige confirmação de identidade. Há teste negativo que impede a mutação para staff e self-merge.

Não existe fusão automática, leitura de identidades secundárias, reconciliação Sunshine, tratamento de BSUID, prévia de perda de dados, escolha livre do perfil sobrevivente nem auditoria própria. A busca usa somente `user.phone` para o critério telefônico; isso não cobre identidades WhatsApp ou números secundários. As variantes brasileiras abrangem apenas o subconjunto legado 8/9; não são prova de titularidade. O mecanismo inicial não está pronto para operar automaticamente em produção.

## Três operações distintas

| Operação | O que precisamos distinguir |
| --- | --- |
| Perfil Support | `user.id`, `external_id`, identidades, organizações, campos e tickets solicitados |
| Usuário Sunshine Conversations | Usuário, clientes por integração, dispositivos, conversas e metadata |
| Ticket Support | Atendimento e seus participantes; consolidar tickets não comprova identidade |

Um perfil Support pode carregar múltiplas identidades de messaging. Selecionar simplesmente a primeira é inadequado para determinar o canal de saída. O artigo [Internal Note: automações WhatsApp](https://internalnote.com/sunshine-conversation-automations/) alerta para essa seleção em usuários já fundidos. Sua implementação é anterior ao BSUID; não copiar a suposição de telefone obrigatório.

## O que BSUID resolve

A [documentação de migração Zendesk](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/whatsapp-bsuid-migration/) descreve identificação por portfólio, telefone opcional e coexistência com clientes legados. Ao criar cliente por telefone, a ativação fica pendente até confirmação da Meta. O fluxo pode terminar em `client:update`, `user:merge` quando a identidade coincide com cliente existente, ou `client:remove` em falha.

**Inferência para nosso produto:** se ambas as grafias brasileiras forem aceitas e confirmadas como a mesma identidade, esse mecanismo pode eliminar parte da duplicação na camada de conversas. Não há promessa documentada de saneamento geral dos perfis históricos Support com/sem 9. Não tomar a resposta inicial da criação como identidade resolvida.

O [anúncio Zendesk](https://support.zendesk.com/hc/en-us/articles/10744666279834-Announcing-changes-to-how-WhatsApp-users-are-identified) informa testes regionais a partir de 30/06/2026 e disponibilidade geral planejada para agosto/2026. Isso é cronograma publicado, não prova de ativação em nossa WABA.

## Matriz de identificação e decisão proposta

As decisões abaixo são políticas propostas do app, não garantias adicionais do Zendesk.

| # | Cenário | Decisão do app / teste necessário |
| --- | --- | --- |
| 1 | Número igual, apenas formatação diferente | Normalizar para busca; confirmar identidade antes da fusão |
| 2 | Mesmo DDD, com/sem nono dígito | Candidato; homologar confirmação Meta para ambas as grafias |
| 3 | Mesmo final, DDD diferente | Não associar por sufixo |
| 4 | DDD 55 versus DDI 55 | Testar ambos sem remover dígitos do número nacional |
| 5 | Fixo, rádio, celular legado ambíguo | Não acrescentar/remover 9 indiscriminadamente |
| 6 | Número internacional, ramal ou entrada malformada | Não aplicar heurística BR; pedir correção quando necessário |
| 7 | Telefone somente em identidade secundária | Consultar identidades; `user.phone` isolado é insuficiente |
| 8 | Nome coincidente | Apenas sugestão, nunca autofusão |
| 9 | E-mail digitado em bot/formulário | Não confundir declaração com autenticação |
| 10 | Identidade CRM autenticada compatível | Candidata à automação após validar escopo e conflitos |
| 11 | Dois IDs externos diferentes | Bloquear automação; investigar titularidade e sistema mestre |
| 12 | Telefone compartilhado/reciclado | Não usar telefone histórico como prova de pessoa |
| 13 | Três ou mais candidatos | Não escolher o mais recente/mais antigo automaticamente |
| 14 | Mesmo BSUID confirmado e mesmo portfólio | Reconciliar vínculo/evento nativo antes de propor outra fusão |
| 15 | BSUIDs de portfólios diferentes | Manter escopos separados |
| 16 | BSUID sem telefone | Funcionar sem telefone; não inventar E.164 nem remover letras |
| 17 | Cliente legado ainda com telefone em externalId | Aceitar os dois modelos durante coexistência |
| 18 | Cliente ainda pending | Aguardar confirmação; não consolidar por antecipação |
| 19 | Atualização de identidade/número | Reavaliar vínculo atual; invalidar associação antiga quando necessário |
| 20 | Mesmo cliente em múltiplos números/WABAs | Selecionar integração correta; não escolher primeira identidade |
| 21 | WhatsApp e perfil de e-mail preexistente | Confirmar pessoa e fundir Support quando cabível |
| 22 | E-mail verificado e usuário impostor não verificado | Não fundir por igualdade textual do e-mail |
| 23 | Dois usuários Sunshine autenticados | Não esperar autofusão; revisão antes da API explícita |
| 24 | Troca de canal entre usuário autenticado e anônimo | Homologar transferência do vínculo, não presumir merge |
| 25 | Login de anônimo no Web Widget/SDK | Consumir evento nativo; não reproduzir merge em paralelo |

O [Zendesk documenta a criação inicial de outro perfil no WhatsApp mesmo com telefone/e-mail já cadastrado](https://support.zendesk.com/hc/en-us/articles/4981113358490-Why-are-some-users-not-correctly-identified-when-they-message-in-through-WhatsApp), e a associação futura depois de fundir os perfis. Esse cenário de Support é diferente de confirmar um BSUID em Sunshine.

O [Internal Note sobre autenticação](https://internalnote.com/messaging-authentication-identify-and-merge-existing-users/) é especialmente útil para entender por que igualdade de e-mail não basta. A referência atual do [Zendesk sobre autenticação](https://support.zendesk.com/hc/en-us/articles/4411666638746-Understanding-and-setting-up-user-authentication-for-messaging) descreve JWT, identidade externa e opções de e-mail verificado/não verificado. Essas opções dizem respeito ao Web Widget/SDK; não transportar suas regras mecanicamente para WhatsApp. Uma identidade de e-mail pode mudar de proprietário sem que todos os históricos sejam fundidos.

## Elegibilidade e preservação

Pelas [regras Support](https://support.zendesk.com/hc/en-us/articles/4408887695898-Merging-a-user-s-duplicate-account), a origem pode perder tags, notas, detalhes e campos personalizados. Tickets são reatribuídos, mas essa mudança não dispara gatilhos. Organizações e contribuições do Help Center precisam de análise própria; não prometer que todo o histórico de perfil ficará intacto.

A [API de usuários](https://developer.zendesk.com/api-reference/ticketing/users/users/) exige permissões e exclui usuários de acordos de compartilhamento. Há uma nuance documental: o Help Center fala em até 10 mil tickets por conta; a API explicita o limite no usuário de origem e também traz uma restrição geral. Tratar os dois perfis como sujeitos a verificação até homologar. O Help Center também restringe fusão em SSO JWT/SAML quando a origem possui ID externo. Não remover IDs externos para contornar isso.

| # | Cenário | Decisão / validação |
| --- | --- | --- |
| 26 | Staff, usuário compartilhado, suspenso ou inacessível | Bloquear quando vedado; suspensão é política conservadora nossa |
| 27 | Limite de tickets, permissão ou SSO impeditivo | Mostrar motivo e respeitar rejeição; sem tentativa de contorno |
| 28 | Tags/notas/detalhes/campos divergentes | Exibir comparação e definir preservação antes da mutação |
| 29 | Organização ou visibilidade diferente | Revisar impacto de acesso e participantes |
| 30 | Perfil atual mais pobre que o candidato | Permitir escolher destino; não privilegiar sempre solicitante atual |
| 31 | Dois agentes fundindo ao mesmo tempo | Coordenar por identidade; revalidar estado antes da execução |
| 32 | Timeout após mutação | Estado indeterminado; reler/reconciliar antes de repetir |
| 33 | Processo parcialmente concluído | Registrar etapa confirmada; não simular rollback de merge |
| 34 | IDs antigos após merge Sunshine | Atualizar referências pelo webhook; não continuar usando ID descartado |
| 35 | SDK/dispositivo com sessão antiga | Homologar acesso depois da fusão e nova autenticação |

Na [fusão Sunshine](https://developer.zendesk.com/documentation/conversations/messaging-platform/users/merging-users/), a API não verifica se as pessoas são iguais. As regras de prevalência de dados diferem do Support; metadata pode ser descartada por limite. Sessões e IDs antigos exigem tratamento. `user:merge` informa sobreviventes/descartados e deve orientar a reconciliação. A junção do histórico depende do modo de conversas e da origem do merge; não confundir isso com a operação de tickets.

## Tickets após mensagem ativa

O [Internal Note sobre tickets duplicados](https://internalnote.com/merging-tickets/) mostra uma automação baseada no último ticket do usuário. É um exemplo útil, mas no nosso caso usar apenas “último ticket” pode juntar assuntos distintos. O identificador da tentativa de contato deve relacionar conversa, integração, destinatário e ticket esperado.

| # | Cenário | Decisão proposta |
| --- | --- | --- |
| 36 | Template na mesma conversa, sem ticket novo | Não executar merge |
| 37 | Novo ticket comprovadamente da mesma retomada | Considerar merge após verificar identidade e atendimento |
| 38 | Mesma pessoa, assuntos diferentes | Preservar tickets separados |
| 39 | Ticket alvo fechado/compartilhado ou ticket de AI agent | Respeitar impedimentos nativos; não forçar |
| 40 | Alvo resolvido | Merge não significa reabertura; definir fluxo explicitamente |
| 41 | Marcas/organizações/requesters/CCs diferentes | Revisão; nenhuma automação cruzada por padrão |
| 42 | Comentários/campos/anexos na origem | Prévia de impacto e visibilidade; não prometer cópia integral |
| 43 | Job de merge aceito mas não terminado | Acompanhar resultados individuais; não mostrar sucesso antecipado |

As [regras de tickets](https://support.zendesk.com/hc/en-us/articles/4408882445594-Merging-tickets) descrevem efeitos em CCs, comentários e campos, além de restrições por status. O histórico não é inteiramente copiado para a conversa do ticket destino. A [API](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/) devolve job assíncrono. Não há rollback de fusão; criar follow-up é uma compensação, não restauração do estado original ([Zendesk](https://support.zendesk.com/hc/en-us/articles/4408821057306-Can-I-un-merge-tickets)).

## Implementação seguinte, em ordem

1. Prévia de origem/destino com identidades, campos e impacto; escolha do sobrevivente; elegibilidade. Não chamar essa etapa de matching confirmado.
2. Resolver Support → identidades messaging → usuários Sunshine → clientes WhatsApp da integração correta.
3. Consumir confirmação e merges nativos, reconciliando aliases de IDs e estados sem telefone. Avaliar o que já desaparece naturalmente com BSUID.
4. Só então adicionar autofusão para evidência forte, política administrativa, ausência de conflitos e operação auditável. Não criar score arbitrário que transforme nome/telefone em autenticação.
5. Tratar tickets em fluxo separado e correlacionado à tentativa de contato.

Homologar os 43 cenários aplicáveis, com fixtures locais e testes reais limitados a dados descartáveis autorizados. A WABA pendente impede a parte real da validação, não a pesquisa nem o desenvolvimento do pré-check. Nesta rodada a entrega é a investigação; os gaps identificados acima ainda não foram implementados.

## Atualização de implementação após a investigação

O app agora lê identidades secundárias, mostra todos os vínculos messaging na revisão e permite inverter o perfil principal. Notas, detalhes, tags e campos que seriam perdidos exigem aceite separado. Perfis suspensos, equipe, compartilhados e origem com ID externo são bloqueados. Antes da chamada, os perfis e identidades são consultados novamente; revisão alterada é invalidada. Após a chamada, o destino é consultado, sem afirmar merge Sunshine. Cada revisão autoriza no máximo uma chamada; timeout exige conferência externa antes de nova tentativa. Testes e UI local com dados fictícios passaram; não houve mutação real. Estas alterações substituem a descrição inicial do código acima; fusão automática, preservação automática, auditoria durável e reconciliação Sunshine continuam pendentes.

Base primária adicional: [relação entre usuários Support e messaging](https://developer.zendesk.com/documentation/conversations/messaging-platform/users/intro-to-users/) e [API de identidades](https://developer.zendesk.com/api-reference/ticketing/users/user_identities/). Cada identidade messaging fornece um ID Sunshine; não selecionar somente a primeira.
