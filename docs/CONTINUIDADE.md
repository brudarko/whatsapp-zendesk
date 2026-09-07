# Retomar o projeto

Este arquivo resume decisões desta conversa para continuar em outra conta ou tarefa. Não é uma exportação integral do chat nem transfere seu histórico para outra conta.

## Projeto e estado verificado

- Pasta: `/Users/bruno.santos/Desktop/Zendesk/zendesk-whatsapp`.
- Remoto privado: https://github.com/brudarko/whatsapp-zendesk.
- Branch `main`, último commit confirmado nesta revisão: `21d0e63`.
- Licença Apache 2.0, preservada do repositório do usuário.
- React, Zendesk Garden, ZAF, esbuild e ZCLI. Instalar com `npm ci`; verificar com `npm test` e `npm run build`; desenvolvimento com `npm run dev`.
- Build e seis testes passaram antes do push. Não equivalem à homologação WhatsApp.
- Sandbox: `d3v-brudarko.zendesk.com`. Usuário estava criando/conectando WABA; reconferir disponibilidade. Não assumir sessão autenticada após trocar de conta.

## Intenção do produto

App open source e gratuito no Marketplace, focado no Brasil, design nativo e configuração simples para leigos. Tarifa Meta, plano Zendesk e hospedagem não são eliminados pela gratuidade do app.

## Implementado

- App nas localizações sidebar, editor e navegação.
- Catálogo de macros de templates existentes, filtro/restrição por grupo e inserção no editor. Não submete templates à Meta nem faz primeiro contato.
- Busca de candidatos a duplicidade por telefone, e-mail ou nome e merge assistido de usuário Support em outro usuário Support.
- Estimativa de janela de 24h pelo histórico disponível.
- Painel local de áudio removido; usar recursos nativos Zendesk.

## Decisões recentes e pendências

1. **Contatos:** não confundir usuário Support com usuário Sunshine. Atualmente só usamos `/api/v2/users/{id}/merge`. Não há merge Sunshine ou reconciliação entre as duas plataformas. Verificar propagação nativa antes de encadear duas fusões. BSUID não é garantia documentada de saneamento dos contatos Support com/sem 9. Prévia de perdas, seleção de destino, identidades secundárias, releitura e consulta posterior implementadas localmente; ver `fusao-contatos-e-bsuid.md` (43 cenários).
2. **Envios:** seção por contato com conteúdo, agente, número empresarial, ticket, aceitação, entrega, leitura, falha e horários. Registrar a tentativa no ticket antes do disparo, mesmo se nunca houver entrega ou resposta. Ainda é especificação, sem backend/webhooks. Validar o vínculo do ticket Support criado previamente com a conversa WhatsApp nativa; não assumir que criar um ticket por API faz esse vínculo.
3. **Áudio:** usuário decidiu aproveitar gravação/envio/playback nativos do Zendesk, retirando essa duplicação do escopo do app. Painel antigo removido nesta etapa. Transcrição foi apenas discutida: modelo local aberto como Whisper evita cobrança de API, mas continua sendo IA e usa recursos do computador. Não há implementação nem decisão de adicionar transcrição.
4. **Templates e onboarding:** falta submissão/sincronização Meta, formatos avançados, envio via Notifications API, serviço persistente com webhooks e configuração WABA completa.
5. **Validação:** nenhum envio real, merge real ou publicação Marketplace foi executado nesta conversa. Não apresentar o app como concluído.

Pesquisa e fontes: `pesquisa-e-arquitetura.md` e `fusao-contatos-e-bsuid.md`. Revalidar documentos voláteis antes de implementar contratos de API.

## Troca de conta no Codex

O código está nesta pasta e no GitHub; uma conversa na interface é um recurso distinto. A documentação oficial informa que os chats mantidos ficam salvos na conta e recomenda conferir conta/workspace quando o histórico desaparece. Não há, nas fontes consultadas, garantia de que este chat aparecerá automaticamente em outra conta.

Fonte: https://help.openai.com/pt-br/articles/20001333-como-arquivar-e-excluir-conversas-do-codex-no-aplicativo-chatgpt

Para continuar caso o chat não apareça, abrir esta pasta na nova conta e pedir: “Leia docs/CONTINUIDADE.md e as pesquisas vinculadas. Confira o código atual e continue a partir das pendências, preservando alterações existentes.”

Não copiar credenciais ou alterar os bancos internos do Codex para tentar transferir a propriedade da conversa.
