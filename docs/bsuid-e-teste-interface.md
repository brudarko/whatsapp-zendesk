# BSUID e teste de interface sem WABA

## Testar no Zendesk

1. Na pasta do projeto, execute `npm ci` e `npm run dev`.
2. Abra https://d3v-brudarko.zendesk.com/agent/tickets/1?zcli_apps=true.
3. Abra Apps → WhatsApp Active Messages → Destinatário.
4. Em Visualização, escolha os dados reais do ticket ou um cenário simulado.

Os cenários BSUID sem telefone, confirmação pendente, destinos divergentes, outra integração e ausência de vínculo usam dados fictícios e não oferecem ação de envio. A simulação não substitui o solicitante do ticket, não altera as outras abas e não cria registros. A leitura de contatos reais usa as permissões ZAF do agente. O servidor ZCLI precisa continuar executando; isso não instala permanentemente o app.

## Implementado nesta etapa

- Reconhecimento separado de BSUID opaco e telefone internacional legado. Nenhuma inclusão/remoção de nono dígito no endereço de envio.
- Resolução dos clientes WhatsApp associados a todas as identidades messaging do usuário Support, pela integração configurada.
- Cliente pendente, destinatários divergentes, integração diferente ou escopo ausente não produzem destino utilizável.
- Chave de identidade inclui aplicativo Sunshine e portfólio. Construção do destino verifica também a integração; não reutiliza um BSUID em outro portfólio.
- Telefone é opcional. Quando há BSUID, o telefone mostrado vem dos identificadores adicionais do cliente, não de uma suposição a partir do perfil Support.
- Leitor paginado da API Sunshine, reutilizado por um comando de diagnóstico local. Não segue URLs arbitrárias recebidas na paginação.

O resolver retorna um registro serializável com IDs e escopo. Sunshine continua sendo a fonte persistente; este app ainda não mantém banco de identidades ou recebe webhooks. O registro deve ser reconsultado antes de uso real, pois cliente, número e BSUID podem mudar. O portfólio deve ser configurado com o valor real da integração, não inferido do prefixo do BSUID.

## Consultar a integração real depois de obter acesso

O comando abaixo é somente leitura e não envia mensagens, cria clientes ou faz merge:

```sh
npm run inspect:identity -- ID_DO_USUARIO_SUPPORT
```

Configurar as variáveis no processo local, sem gravar credenciais no código ou no Git:

- `ZENDESK_SUBDOMAIN`: subdomínio da conta.
- `ZENDESK_OAUTH_TOKEN`: token OAuth com acesso aos usuários e identidades Support (a API de identidades não aceita os escopos específicos users:read/users:write; conferir a documentação de escopos).
- `SUNSHINE_APP_ID`, `SUNSHINE_KEY_ID`, `SUNSHINE_SECRET`: credenciais da Conversations API.
- `WHATSAPP_INTEGRATION_ID` e `META_PORTFOLIO_ID`: integração e portfólio correspondentes.

O comando faz GET no host HTTPS da própria conta, com timeout e sem seguir redirecionamentos. O resultado contém dados do contato: não publicar sua saída em logs públicos. Nenhuma credencial entra no frontend. A consulta autenticada Sunshine ainda não está conectada à aba ZAF: os dados reais da aba mostram somente as identidades Support e deixam explícito que o BSUID não foi consultado.

## Fontes e limites

- [Modelo de usuários e vínculos Support/Sunshine](https://developer.zendesk.com/documentation/conversations/messaging-platform/users/intro-to-users/).
- [Migração BSUID](https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/whatsapp-bsuid-migration/).
- [Contrato oficial OpenAPI Sunshine: clientes, autenticação, paginação e região](https://github.com/zendesk/sunshine-conversations-api-spec/blob/master/openapi.yaml).
- [Requisições ZAF e limitações de secure settings no ZCLI](https://developer.zendesk.com/documentation/apps/app-developer-guide/making-api-requests-from-a-zendesk-app/).

16 testes locais e build passaram. A aba foi testada no ticket de exemplo do sandbox, com leitura real de identidades e simulações sem mutações. A consulta autenticada Sunshine e o envio com BSUID não foram homologados: WABA/acesso ainda pendentes. O transporte de mensagens e a persistência de recibos continuam fora desta implementação; preparar um destino não envia uma mensagem.
