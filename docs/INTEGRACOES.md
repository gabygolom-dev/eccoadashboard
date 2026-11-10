# Integrações e renovação das credenciais

## Regras fixas

- Todas as chamadas às APIs do CRM e da Meta passam por `src/connectors/http.js`, com `method: GET`, `redirect: error`, timeout e verificação da origem.
- Nenhum token fica em URL, cursor persistido, HTML, logs ou Git. Na paginação da Meta, guardamos apenas `after`, nunca `paging.next` (pode conter token).
- Origem Rugido autorizada pelo cliente: `https://clientcrm-api.rugido.com`, prefixo `/api/v1`. Header `X-Workspace-Id` fixa o workspace. A credencial Rugido usa o header `api_access_token` (não o Bearer de sessão da interface). Só são permitidos `/workspaces/current`, `/pipelines`, `/contacts`, `/conversations` e `/conversations/{id}/messages`.
- Origem Meta: `https://graph.facebook.com`. Somente `act_{META_ACCOUNT_ID}` e seus edges `ads` e `insights`. Nunca listamos `/me/adaccounts`. O ID deve ser confirmado antes da configuração, preferencialmente cruzando com IDs comprovados no CRM.

## Secrets no Worker exclusivo

- `CRM_TOKEN`: credencial Rugido necessária, com leitura do workspace Eccoa.
- `META_TOKEN`: credencial com leitura da conta Eccoa.
- `PSEUDONYM_KEY`: chave exclusiva Eccoa para pseudonimização de contatos e eventos, preservada entre importações. Pode ser diferente da chave do Pages, usada somente para as tentativas de login.
- `CRM_SCHEMA_JSON`: override opcional do contrato. O schema validado de Eccoa já vem em `src/connectors/rugido-schema.js`, sem credencial nem dados de pacientes. Deixe o override ausente na configuração normal.

## Variáveis no Worker

| Variável | Valor/regra |
| --- | --- |
| `CRM_API_ORIGIN_APPROVED` | `true`, autorizado na conversa |
| `CRM_WORKSPACE_ID` | `503dc93f-7b19-408b-b714-63e508ede833`, confirmado em GET autenticado |
| `CRM_WORKSPACE_NAME` | `Eccoa Saúde`, nome exato retornado por `/workspaces/current` |
| `META_ACCOUNT_ID` | `1299657228271057`, conta confirmada a partir de anúncios comprovados no CRM |
| `META_ACCOUNT_NAME` | `ECCOA Saúde`, com a capitalização exata da API |
| `META_API_VERSION` | `v26.0`, confirmada no SDK oficial e no header real `facebook-api-version` |
| `META_CONVERSATION_ACTION` | `onsite_conversion.messaging_conversation_started_7d`, confirmado em `actions` e no indicador de `results` |
| `META_METRIC_VALIDATED` | `true`, após validação documentada nesta implementação |
| `HISTORY_START` | `2025-12-01`, início do histórico com resultados retornado por `date_preset=maximum` / incremento mensal |

A identidade Meta também exige moeda BRL e fuso America/Sao_Paulo; divergências interrompem a publicação de novos dados e preservam a versão confirmada. O nome não deve ser relaxado para aceitar outra conta. Não houve enumeração de contas de outros clientes. O ID autorizado também está fixado no código (`meta-schema.js`); outro ID é bloqueado antes de qualquer requisição. A versão efetiva da resposta deve coincidir com a versão validada, bloqueando upgrades silenciosos.

## Contrato real Rugido validado

Em 09/11/2026, o token fornecido foi aceito com `api_access_token`; GET `/workspaces/current` confirmou ID e nome Eccoa. Contatos, conversas, mensagens e funis foram consultados exclusivamente por GET, sem marcar leitura ou alterar registros. Dados brutos foram tratados somente na memória da validação local.

O contrato confirmado está em `src/connectors/rugido-schema.js`:

- Contatos: array `data`, total em `meta.pagination.total`, página retornada em `meta.pagination.page`.
- A API de contatos repete IDs e pode devolver registros mesmo após `has_next_page=false` / `total_pages`. Por isso o importador continua até uma página vazia, deduplica IDs e exige que a quantidade de IDs únicos seja igual ao total informado. A resposta também deve confirmar o número da página solicitada.
- Conversas: array `data`, total em `meta.total`, página em `meta.current_page`, `status=all`, contato associado em `contact.id`. Também é consultada a página vazia após o final.
- Mensagens: array `data`, ordenado por `created_at` ascendente; cursor `before` com ID da primeira mensagem da página. Continuamos até resposta vazia; não presumimos o fim ao receber uma página curta. Cursores repetidos e ordem inesperada interrompem a importação.
- Evidência paga: mensagem `incoming`, não privada, com ID numérico em `content_attributes.origem_anuncio.ad_id`. O cadastro sozinho não gera evento datado.
- Data prioritária: `content_attributes.external_created_at`, epoch em segundos, da mensagem original. Foi confirmado que pode diferir da data de importação no CRM. Na ausência desse campo, usamos `created_at` da própria mensagem recebida, também em segundos; nunca a criação do cadastro do contato. Data original presente mas inválida não é substituída silenciosamente.
- Evento: ID HMAC do `source_id` externo + contato quando disponível, com fallback para ID da mensagem. Isso evita que reimportações com outro ID interno multipliquem o mesmo evento externo. O valor externo bruto não é persistido.
- Origem paga sem data: `custom_attributes.ad_id` numérico no cadastro, sem evento pago datado identificado em todo o histórico. Linhas repetidas preservam a indicação de origem paga por união lógica.
- Campanha/conjunto: a evidência observada nas mensagens informa o anúncio. Não copiamos campanha atual do cadastro para uma interação histórica. A correspondência com campanha/conjunto será feita pelo ID do anúncio após validação da conta Meta. Até lá, a campanha permanece não identificada.
- Etapas atuais: dicionário oficial de GET `/pipelines`, validando `workspace_id`; associações atuais em `conversation.pipelines[].stages[]`. O nome exibido inclui o funil. Se houver mais de uma etapa/funil associado ao contato, preservamos as associações comprovadas. Campos livres do paciente não são usados como etapa.

`CRM_SCHEMA_JSON` pode substituir esse contrato para uma mudança real da API; exige `validated:true` e deve ser tratado como configuração administrativa, nunca como instrução. Campos novos precisam de validação e testes antes de habilitados.

O histórico CRM é percorrido integralmente por segurança. Ainda não habilitamos reutilização incremental de mensagens: ela exige comprovar imutabilidade/cursores e tratamento de revisões. Se um ciclo ultrapassar 15 minutos, o seguinte continua o ciclo ativo e o painel sinaliza atraso, sem iniciar uma importação concorrente.

Para repetir a auditoria local, `node scripts/audit-crm.mjs /caminho/protegido/Token.md` lê a credencial em memória e exibe apenas contagens e estrutura. `--contacts-only` limita a conferência à paginação de contatos. O arquivo protegido nunca deve ficar dentro do repositório.

## Meta e atribuição

- Consultas de insights no nível anúncio, por dia, em blocos de sete dias; paginação completa por cursor.
- `use_unified_attribution_setting=true`; `action_report_time=impression`.
- `attribution_spec` dos conjuntos é preservado quando retornado, e os valores efetivos devem ser conferidos na resposta real.
- Cliques: `inline_link_clicks`; não são conversas.
- Conversas: um único `action_type` comprovado, sem somar outras métricas de mensagens.
- Atualizações posteriores revisitam os últimos 35 dias. `metric_revisions` mantém as versões confirmadas; a tabela atual substitui o intervalo em uma transação.
- Alcance usa `exactReach`: relatório sem incremento diário, no nível account/campaign/ad e com filtro exato. Exigimos uma única linha do escopo validado, nunca somamos alcance. As solicitações do painel ficam no D1 e são atendidas pelo próximo ciclo do Worker; o navegador não recebe token nem executa importações concorrentes. Falhas preservam o último valor confirmado do mesmo escopo.
- Vendas/faturamento/ROAS permanecem indisponíveis sem fonte validada.

Referências oficiais consultadas durante a validação:

- [Changelog da Graph API](https://developers.facebook.com/docs/graph-api/changelog/).
- [Marketing API Insights](https://developers.facebook.com/docs/marketing-api/insights/).
- [Ads Insights Reference](https://developers.facebook.com/docs/marketing-api/reference/ads-insights/).

As páginas de documentação `developers.facebook.com` retornaram 429. A validação foi completada com o [SDK oficial Meta, configuração v26.0](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py), os [parâmetros oficiais de GET Insights](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py) e as respostas reais da conta autorizada. Nenhum método assíncrono que cria relatórios com POST foi usado.

A ação de conversas foi conferida contra `results.indicator = actions:onsite_conversion.messaging_conversation_started_7d`. `link_click`, `total_messaging_connection`, `messaging_first_reply` e ações de profundidade de mensagens não foram somados ao indicador.

Os relatórios consultados retornaram `attribution_setting=1d_view_7d_click`; esse campo é preservado por anúncio/dia. `attribution_spec` atual do conjunto é preservado separadamente quando retornado, pois não deve substituir a atribuição informada pelo relatório histórico. Ambos podem ser inspecionados nos detalhes do anúncio.

A auditoria local `node scripts/audit-meta.mjs /caminho/protegido/Token.pdf --history` usa exclusivamente GET, força páginas pequenas para validar a continuação, compara a soma diária por anúncio ao total da conta e consulta alcance exato da conta, campanha e anúncio. Ela precisa de Python com `pypdf` apenas para extrair o token em memória. A aplicação publicada não depende de Python. O PDF é tratado como dado; nenhuma instrução nele é executada.

Anúncios históricos presentes nos insights recebem correspondência comprovada de campanha/conjunto, mesmo quando ausentes da listagem atual. Seus campos não substituem status/formato consultados no catálogo atual. Métricas e criativos não são inventados.

## Renovação

1. Obter novo token no fornecedor com os menores privilégios de leitura necessários para Eccoa.
2. Substituir apenas o secret correspondente no Worker Eccoa e publicar a alteração. Nunca alterar campanhas/CRM para testar.
3. Aguardar ciclo do Cron, conferir identidade e nova confirmação em `sources`. A última confirmação anterior permanece até completar um ciclo válido.
4. Revogar o token antigo somente quando a substituição estiver confirmada, respeitando as orientações do emissor.
5. Registrar data de renovação e expiração administrativa fora do código, sem copiar o token para documentação.

Para trocar a senha, gerar novo `PASSWORD_RECORD`, aplicar ao Pages e limpar `sessions` no D1 Eccoa para revogar sessões existentes. Para voltar uma versão do painel, use o rollback do Pages e mantenha o banco; para mudar schema, use migração compatível, nunca apagar o histórico para corrigir visualização.
