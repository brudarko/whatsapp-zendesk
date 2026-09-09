# Experiência e cobertura de templates

## Decisões de experiência

Base: relato e captura de tela do responsável pelo produto em 08/09/2026. O formulário anterior tinha campos muito largos, pouca hierarquia, prévia distante e não permitia escolher o formato. Não foram realizadas entrevistas ou testes com usuários finais; as decisões abaixo são hipóteses de design verificadas com inspeção local.

Tarefa principal: encontrar uma mensagem aprovada ou criar uma nova sem conhecer o payload da API. Fluxo: catálogo → categoria/tipo → conteúdo e exemplos → revisão → aprovação Meta. A criação fica somente na página grande do menu lateral, para administradores; o menu lateral não tem mais aba de catálogo. Ao selecionar qualquer template nessa página, o administrador informa nome de exibição, descrição breve e grupos — a macro do Zendesk guarda os três (título, description e restriction) e pode ser editada depois pelo mesmo painel. Template ainda em análise é salvo como macro inativa, fora do catálogo de envio, até a Meta aprovar. O agente escolhe pelo nome de exibição e lê o caso de uso na hora de enviar, nunca pelo nome técnico da Meta. Formatos com mídia, botões ou carrossel são recusados na publicação porque o envio ainda não os cobre. Ticket, Customers e menu superior preservam as tarefas de atendimento/envio.

Componentes de formulário e ações usam [Zendesk Garden](https://garden.zendesk.com/components/). A prévia acompanha o editor em telas largas e se empilha em telas estreitas. Labels associados aos campos, foco no título ao trocar etapa, alertas acessíveis e exemplos gerados a partir das variáveis. Busca por nome/idioma e filtro de status evitam percorrer uma lista inteira.

Critérios para futura pesquisa com agentes: encontrar um aprovado, criar um aviso com variável, distinguir pendente de aprovado e entender quando uma conexão adicional é necessária. Medir conclusão sem ajuda e erros por tarefa; ainda não há resultados de pesquisa com usuários.

## Cobertura de criação

| Formato | Editor e validação local | Publicação |
| --- | --- | --- |
| Texto, cabeçalho de texto, rodapé, resposta rápida, site, telefone | Implementados | Sunshine |
| Imagem, vídeo e PDF no cabeçalho | Implementados com upload de exemplo | Meta direta |
| Variáveis nomeadas | Implementadas | Meta direta |
| Autenticação copiar / um toque / zero toque | Implementadas; apps Android e termos no zero toque | Meta direta |
| Localização | Implementada; coordenadas definidas no envio | Meta direta |
| WhatsApp Flows | Implementado; requer ID de Flow já publicado | Meta direta |
| Cupom e oferta por tempo limitado | Implementados; cupom opcional na oferta | Meta direta |
| Carrossel de mídia | Implementado; 2–10 cartões com mesma estrutura | Meta direta |
| Catálogo, produto único, vários produtos, carrossel de produtos | Implementados; catálogo e produtos necessários no envio | Meta direta |
| Permissão para chamada e botão de chamada WhatsApp | Implementados | Meta direta; elegibilidade da conta |
| Pedido/pagamento, status de pedido, checkout | Cartão não clicável com link para o Gerenciador do WhatsApp | Não implementada no app |

Esta tabela não significa suporte ao **envio** de todos esses tipos. O transporte de mensagens e a sincronização de templates aprovados com o catálogo de envio têm escopo próprio e ainda precisam ser ampliados. A criação avançada e o upload não foram homologados com credenciais Meta válidas. Os testes verificam construção/validação dos payloads e APIs simuladas. O cadastro básico `teste_teste` foi aceito pelo Sunshine com HTTP 201 e status PENDING em 08/09/2026; isso não demonstra aceitação de todos os formatos pela conta real.

O servidor verifica se o WABA ID da conexão Meta corresponde ao `accountId` da integração WhatsApp Sunshine antes de usar o token. Sem configuração, os formatos avançados podem ser preparados, mas não submetidos. Não há persistência de rascunhos. A aprovação é assíncrona e depende da Meta. Pagamentos têm regras regionais: não inferir disponibilidade no Brasil a partir de documentação de outro país.

## Fontes oficiais consultadas

- [Sunshine: WhatsApp Message Templates](https://docs.smooch.io/rest/v1/#whatsapp-message-templates)
- [Meta: visão geral](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Meta: componentes](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/)
- [Meta: autenticação](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates/)
- [Meta: zero toque](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/zero-tap-authentication-templates/)
- [Meta: localização](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/location-templates/)
- [Meta: Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flows-templates/)
- [Meta: ofertas limitadas](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates/)
- [Meta: carrossel de mídia](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates/)
- [Meta: catálogo](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalog-template-messages)
- [Meta: SPM](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/spm-template-messages)
- [Meta: MPM](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/mpm-template-messages)
- [Meta: carrossel de produtos](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/product-card-carousel-template-messages)
- [Meta: upload de exemplos](https://developers.facebook.com/docs/graph-api/guides/upload/)
