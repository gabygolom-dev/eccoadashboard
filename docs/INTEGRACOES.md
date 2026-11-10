# Integrações e renovação das credenciais

## Regras fixas

- Todas as chamadas às APIs do CRM e da Meta passam por `src/connectors/http.js`, com `method: GET`, `redirect: error`, timeout e verificação da origem.
- Nenhum token fica em URL, cursor persistido, HTML, logs ou Git. Na paginação da Meta, guardamos apenas `after`, nunca `paging.next` (pode conter token).
- Origem Rugido autorizada pelo cliente: `https://clientcrm-api.rugido.com`, prefixo `/api/v1`. Header `X-Workspace-Id` fixa o workspace. Só são permitidos `/workspaces/current`, `/contacts`, `/conversations` e `/conversations/{id}/messages`.
- Origem Meta: `https://graph.facebook.com`. Somente `act_{META_ACCOUNT_ID}` e seus edges `ads` e `insights`. Nunca listamos `/me/adaccounts`. O ID deve ser confirmado antes da configuração, preferencialmente cruzando com IDs comprovados no CRM.

## Secrets no Worker exclusivo

- `CRM_TOKEN`: credencial Rugido necessária, com leitura do workspace Eccoa.
- `META_TOKEN`: credencial com leitura da conta Eccoa.
- `PSEUDONYM_KEY`: mesma chave exclusiva do Pages.
- `CRM_SCHEMA_JSON`: contrato validado dos campos retornados pelo CRM. Não contém credencial nem dados de pacientes.

## Variáveis no Worker

| Variável | Valor/regra |
| --- | --- |
| `CRM_API_ORIGIN_APPROVED` | `true`, autorizado na conversa |
| `CRM_WORKSPACE_ID` | ID exato do workspace Eccoa |
| `CRM_WORKSPACE_NAME` | Nome exato retornado por `/workspaces/current` |
| `META_ACCOUNT_ID` | ID numérico da conta Eccoa Saúde, sem `act_` |
| `META_ACCOUNT_NAME` | Nome exato confirmado da conta |
| `META_API_VERSION` | Versão vigente confirmada; não existe default presumido |
| `META_CONVERSATION_ACTION` | Tipo de ação confirmado na resposta real; candidato a verificar: `onsite_conversion.messaging_conversation_started_7d` |
| `META_METRIC_VALIDATED` | `true` apenas após validar esse tipo de ação contra resultados de conversas iniciadas; até lá o indicador fica indisponível |
| `HISTORY_START` | Data inicial inclusiva de cobertura Meta (`AAAA-MM-DD`) confirmada para o projeto |

A identidade Meta também exige moeda BRL e fuso America/Sao_Paulo; divergências interrompem a publicação de novos dados e preservam a versão confirmada. O nome não deve ser relaxado para aceitar outra conta. Não há enumeração de contas de outros clientes.

## Contrato real Rugido

O frontend público consultado em 09/11/2026 confirmou a origem da API, o header de workspace e as rotas GET usadas. Ele **não comprova** os campos de atribuição, as respostas autenticadas ou a cobertura do token. Por isso não presumimos que a API seja Chatwoot, não inventamos JSON paths e bloqueamos a importação até confirmar o schema real.

O contrato precisa informar:

- `validated: true` após validação com respostas reais autorizadas.
- `workspace.id`, `workspace.name`: caminhos para ID/nome na resposta de `/workspaces/current`.
- `stageNames`: dicionário `{ID_ETAPA: NOME_OFICIAL}` validado no CRM. Nunca usar campo livre de nome de paciente como etapa.
- `contacts`: `items`, `total`, `id`, `stageId`, `paidFlag`, `paidValue`, `perPage` e `params` se necessário. `paidFlag` é opcional; seu valor precisa provar origem paga, sem inferência a partir de ausência de dados.
- `conversations`: `items`, `total`, `id`, `perPage`, `params` necessários para incluir TODAS as conversas do workspace (todos os status, sem filtro pessoal). Listagens são verificadas pelo total e pela unicidade de IDs.
- `messages`: `items`, `hasMore`, `nextCursor`, `cursorParam`, `params`. A continuação deve ser explicitamente comprovada; ausência de metadados não é presumida como fim de histórico.
- `evidence`: caminhos `id`, `contactId`, `direction`, `incomingValue`, `paidProof`, `paidValue`, `timestamp`, `timestampUnit` (`iso`, `seconds` ou `milliseconds`), `campaignId`, `adsetId`, `adId`. `paidProof` deve ser metadado real de origem paga na mensagem recebida. Não usamos data de cadastro ou interpretação do texto da mensagem. Campos ausentes de campanha/anúncio permanecem não identificados.

O conector atual exige paginação de listagem com total e mensagens com cursor/hasMore explícitos. Se o Rugido retornar outro contrato real, o adaptador deve ser ajustado e testado antes de `validated=true`. A falta de um campo não autoriza inventar seu valor. Eventos pagos com data ausente ficam separados. Os corpos brutos só passam pela memória do Worker; o banco recebe uma projeção de IDs pseudonimizados, datas, referências de anúncios e etapas.

O histórico CRM é percorrido integralmente a cada ciclo por segurança. Ainda não há otimização incremental de mensagens: só deve ser habilitada após comprovar ordenação, imutabilidade e cursores estáveis. Se a duração de um ciclo ultrapassar 15 minutos, o seguinte continua o ciclo ativo, sem iniciar outro. O painel sinaliza atraso.

## Meta e atribuição

- Consultas de insights no nível anúncio, por dia, em blocos de sete dias; paginação completa por cursor.
- `use_unified_attribution_setting=true`; `action_report_time=impression`.
- `attribution_spec` dos conjuntos é preservado quando retornado, e os valores efetivos devem ser conferidos na resposta real.
- Cliques: `inline_link_clicks`; não são conversas.
- Conversas: um único `action_type` comprovado, sem somar outras métricas de mensagens.
- Atualizações posteriores revisitam os últimos 35 dias. `metric_revisions` mantém as versões confirmadas; a tabela atual substitui o intervalo em uma transação.
- Alcance fica indisponível: o projeto não soma alcance diário ou de anúncios. Para habilitar, implementar e validar um relatório exato para cada período e escopo solicitado.
- Vendas/faturamento/ROAS permanecem indisponíveis sem fonte validada.

Referências oficiais a conferir durante a validação de credenciais:

- [Changelog da Graph API](https://developers.facebook.com/docs/graph-api/changelog/).
- [Marketing API Insights](https://developers.facebook.com/docs/marketing-api/insights/).
- [Ads Insights Reference](https://developers.facebook.com/docs/marketing-api/reference/ads-insights/).

Na implementação inicial, as páginas oficiais da Meta retornaram 429/indisponibilidade ao acesso automatizado. Portanto, **não declaramos a versão vigente ou a métrica de conversas como validadas**. Essas verificações precisam ocorrer antes de habilitar o indicador real.

## Renovação

1. Obter novo token no fornecedor com os menores privilégios de leitura necessários para Eccoa.
2. Substituir apenas o secret correspondente no Worker Eccoa e publicar a alteração. Nunca alterar campanhas/CRM para testar.
3. Aguardar ciclo do Cron, conferir identidade e nova confirmação em `sources`. A última confirmação anterior permanece até completar um ciclo válido.
4. Revogar o token antigo somente quando a substituição estiver confirmada, respeitando as orientações do emissor.
5. Registrar data de renovação e expiração administrativa fora do código, sem copiar o token para documentação.

Para trocar a senha, gerar novo `PASSWORD_RECORD`, aplicar ao Pages e limpar `sessions` no D1 Eccoa para revogar sessões existentes. Para voltar uma versão do painel, use o rollback do Pages e mantenha o banco; para mudar schema, use migração compatível, nunca apagar o histórico para corrigir visualização.
