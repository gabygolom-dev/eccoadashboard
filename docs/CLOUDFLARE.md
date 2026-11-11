# Publicação Eccoa pelo GitHub, sem Wrangler

Este projeto usa Cloudflare Pages + Pages Functions para o painel. A sincronização usa um Worker separado, D1 e Queue. **Pages sozinho não executa Cron Triggers.** Todos os recursos abaixo são exclusivos da Eccoa.

## 1. Pages existente

No projeto **eccoadashboard**, conectado a `gabygolom-dev/eccoadashboard`:

- Branch de produção: `main`.
- Framework: nenhum.
- Comando de build: `npm run build`.
- Diretório de saída recomendado: `dist`. O build também espelha os arquivos públicos na raiz do repositório para compatibilidade com projetos Pages configurados sem diretório de saída.
- Diretório raiz: raiz do repositório.
- Node: 22 ou superior (`NODE_VERSION=22`).

A pasta `functions/` é implantada pelo Pages. Não publique apenas arquivos estáticos: isso retiraria a proteção do servidor. `_routes.json` deve permanecer com todas as rotas incluídas. A URL oficial deve ser copiada do projeto Pages após o deploy; não presumimos que um endereço esteja ativo só pelo nome do projeto.

## 2. Banco exclusivo

Em Storage & databases → D1, crie **eccoa-dashboard-db**. No console SQL do próprio banco, execute, nesta ordem, as migrações [`0001.sql`](../migrations/0001.sql), [`0002_reach.sql`](../migrations/0002_reach.sql), [`0003_conversation_cache.sql`](../migrations/0003_conversation_cache.sql) e [`0004_free_plan_indexes.sql`](../migrations/0004_free_plan_indexes.sql). Aplique as que ainda faltarem; reexecutar é seguro (IF NOT EXISTS/INSERT OR IGNORE). Se o console aceitar só uma instrução por execução, execute cada instrução separadamente.

No Pages → Settings → Bindings, adicione um D1 binding:

- Nome: `ECCOA_DB`.
- Banco: `eccoa-dashboard-db`.

Use somente o banco Eccoa. Após alterar bindings/secrets, faça novo deployment pelo Pages (Retry deployment) para aplicá-los. Não habilite previews com credenciais de produção de forma indiscriminada.

## 3. Senha e anonimização

No Pages → Settings → Variables and Secrets, configure como **secrets criptografados**, na produção:

- `PASSWORD_RECORD`: registro PBKDF2 da senha privada do cliente.
- `PSEUDONYM_KEY`: chave aleatória exclusiva Eccoa com pelo menos 32 caracteres.

A senha deve ter pelo menos 9 caracteres, conforme a configuração solicitada pelo cliente. O script local `scripts/password-record.mjs` lê somente `dashboardPassword` de um JSON protegido fora do repositório. Em um terminal privado no macOS, use `node scripts/password-record.mjs /caminho/protegido/eccoa.json | pbcopy`, depois cole em `PASSWORD_RECORD`. Não inclua senha na linha de comando nem imprima o arquivo protegido.

No Worker, `PSEUDONYM_KEY` gera os IDs pseudonimizados dos contatos e eventos. Preserve essa chave após a primeira importação; não a rotacione sem um plano de migração dos IDs históricos. No Pages, a variável de mesmo nome serve à limitação de tentativas de login e pode ter uma chave independente: o Pages consulta os IDs já preparados pelo Worker, sem recalculá-los. As duas chaves devem ser exclusivas Eccoa. Não é necessário colocar os tokens Meta/Rugido no Pages: somente o Worker precisa deles.

Sem os bindings e secrets, a tela de login mostra “Acesso em configuração” e os dados permanecem bloqueados.

## 4. Worker de sincronização pelo editor do painel

Em Workers & Pages, crie um novo Worker chamado **eccoa-dashboard-sync**. Não modifique nenhum Worker de outro cliente. O build gera [`deploy/eccoa-sync-worker.mjs`](../deploy/eccoa-sync-worker.mjs), um único módulo JavaScript sem dependências externas.

No editor do novo Worker, substitua o código pelo conteúdo integral desse arquivo e publique. Para atualizar o Worker após mudanças no repositório, repita a cópia do arquivo gerado. **A integração GitHub → Pages atualiza o painel automaticamente; não atualiza esse Worker separado.** Não configure comandos Wrangler.

Adicione ao Worker:

- Binding D1 `ECCOA_DB` → banco **eccoa-dashboard-db**.
- Binding de produtor Queue `ECCOA_JOBS` → fila **eccoa-dashboard-jobs** (próxima etapa).
- Secrets e variáveis de integração descritos em `INTEGRACOES.md`.

O Worker não expõe endpoint HTTP de importação; todas as chamadas HTTP recebem 404. O botão do painel não dispara importações.

## 5. Queue e Cron persistentes

Crie uma Queue exclusiva **eccoa-dashboard-jobs**. Configure como consumidor o Worker **eccoa-dashboard-sync**:

- Batch size: `1`.
- Maximum concurrency: `1`.
- Batch timeout: `1` segundo.
- Retry delay: `120` segundos (se disponível).
- Retentativas da plataforma: ao menos `10`.

A aplicação já grava checkpoints, usa lease por execução, impede ciclos ativos duplicados e aplica retentativas com atraso. A Queue continua o processamento mesmo com o painel fechado. Cada mensagem processa até quatro etapas sequenciais, ou cinco no histórico de mensagens do CRM, persistindo o checkpoint após cada etapa. A chave de assinatura dos IDs é reutilizada em memória para limitar o trabalho criptográfico. O próximo Cron também reenfileira ciclos ativos caso tenha ocorrido interrupção no envio de uma continuação. Sem a Queue, a atualização automática não está pronta.

No Worker → Settings → Triggers, adicione Cron `*/15 * * * *`. Esse Cron dispara em UTC nos minutos 00, 15, 30 e 45, equivalente aos mesmos minutos em São Paulo. A aplicação registra datas de contato no fuso America/Sao_Paulo.

Desative logs de conteúdo das requisições/respostas e não ative captura de mensagens de pacientes. O código não registra corpos de respostas nem tokens.

## 6. Configuração não confidencial do Pages

- `CLIENT_NAME=Eccoa Saúde`.
- `CRM_WORKSPACE_NAME=Eccoa Saúde`: nome exato validado do workspace Eccoa.
- `META_ACCOUNT_ID=1299657228271057`: conta Eccoa validada.
- `META_API_VERSION=v26.0`: versão confirmada no SDK oficial e nas respostas reais.
- As marcas já estão nos arquivos publicados, com proporção preservada: `public/assets/rugido-simbolo-oficial.png` e `public/assets/eccoa.png`. O símbolo Eccoa foi preparado a partir do print fornecido, removendo o fundo azul do perfil. Não é necessário configurar `BRANDS_READY`; essa variável foi dispensada. A logo Eccoa também aparece na tela de login.

Essas variáveis apenas identificam as conexões no painel; não concedem acesso às APIs.

## 7. Validação em produção (obrigatória antes de aceitar a entrega)

1. Navegação privada: login acessível, `/api/report`, `/app.js` e módulos privados bloqueados sem sessão; CSS e logos públicas retornam os tipos corretos, sem redirecionamento para login; arquivos de código/configuração retornam 404.
2. Senha correta permite acesso; senha incorreta é recusada; sexta tentativa no mesmo IP em 15 minutos recebe 429; logout invalida a sessão no banco.
3. Após o primeiro Cron, `settings.lastCron` deve mudar. `runs` deve avançar em páginas e concluir para cada fonte. Confira ambos os horários em Configurações e na visão geral.
4. Confirme no D1 `sources.identity_json` o workspace e a conta Eccoa antes de aceitar os dados. Os conectores abortam quando ID ou nome não correspondem à configuração autorizada.
5. Compare período, campanha e anúncio com CRM/Meta. A soma de contatos das campanhas deve ser o total; contatos sem campanha permanecem no total.
6. Observe um segundo disparo automático real, sem navegador aberto, e confira os novos horários. Um horário futuro exibido é só previsão, não comprovação de agendamento.
7. Teste falha em ambiente isolado, nunca revogando uma credencial de outro cliente; dados confirmados devem permanecer. Os testes automatizados locais verificam essa propriedade transacional.
8. Anote URL real, commit, horários confirmados e limitações em `VALIDACAO.md`.

A infraestrutura tem custos e limites da conta Cloudflare. Nenhum recurso de outro cliente deve ser renomeado, compartilhado ou reutilizado. Backups do banco contêm apenas dados minimizados; proteja o acesso administrativo.

O cliente escolheu manter o plano gratuito. Ele tem limite de 50 consultas D1 por execução, 5 milhões de linhas lidas e 100 mil linhas escritas por dia e 10 mil operações de fila por dia. A implementação usa snapshots temporários por página, confirmação apenas dos cadastros e métricas que mudaram, cache de versões de conversas e lotes limitados de processamento. Leituras de contatos sem data e de histórico usam índices específicos.

Metadados Meta usam páginas compactas de anúncios; referências que aparecem apenas no histórico recebem fallback separado, sem sobrescrever metadados atuais.

A confirmação dos contatos compara um snapshot canônico de IDs pseudonimizados, etapas e indicação de origem paga. As páginas temporárias são lidas como linhas compactas e deduplicadas no Worker, evitando expandir milhares de itens no SQLite para repetir a mesma contagem. Todas as páginas da API continuam sendo consultadas e a cobertura continua sendo exigida antes de confirmar.

O cache `settings.crmContactSnapshotV1` é atualizado na mesma transação dos contatos e da confirmação da fonte. Sem mudanças, não há revarredura da tabela inteira nem regravação do cache. Com mudanças, apenas os IDs alterados são enviados ao banco. Um cadastro ausente da listagem perde apenas a etapa atual; eventos e IDs históricos permanecem. A primeira execução compara com a base confirmada para inicializar o cache. Se o cache ultrapassar 1,5 MB, a aplicação compara diretamente com os dados confirmados, sem ultrapassar o limite de valor do D1. Nenhuma migração ou novo secret é necessário para essa otimização.

Snapshots de execuções concluídas ou falhas são removidos uma hora após o término; eventos confirmados, revisões reais de métricas e histórico das execuções ficam preservados em tabelas próprias. Isso evita acumular centenas de megabytes de cópias temporárias no banco de 500 MB. A limpeza nunca remove snapshots de execução ativa. Confira uso real no D1 e na fila ao validar a produção; não mude o plano nem autorize cobranças automaticamente. Referências: [limites D1](https://developers.cloudflare.com/d1/platform/limits/), [preços D1](https://developers.cloudflare.com/d1/platform/pricing/) e [preços Queues](https://developers.cloudflare.com/queues/platform/pricing/).

## Valores confirmados para o Worker Eccoa

Configure estes valores **não secretos** no Worker `eccoa-dashboard-sync`:

```text
CRM_API_ORIGIN_APPROVED=true
CRM_WORKSPACE_ID=503dc93f-7b19-408b-b714-63e508ede833
CRM_WORKSPACE_NAME=Eccoa Saúde
META_ACCOUNT_ID=1299657228271057
META_ACCOUNT_NAME=ECCOA Saúde
META_API_VERSION=v26.0
META_CONVERSATION_ACTION=onsite_conversion.messaging_conversation_started_7d
META_METRIC_VALIDATED=true
HISTORY_START=2025-12-01
```

Configure `CRM_TOKEN`, `META_TOKEN` e `PSEUDONYM_KEY` como **secrets**, nunca como valores no GitHub. Copie cada token de seu arquivo protegido, sem adicionar rótulos, espaços ou quebras de linha. O PDF pode quebrar o token Meta em várias linhas; elas precisam ser reunidas em uma única sequência. O valor da credencial não consta neste guia.

`CRM_SCHEMA_JSON` pode ficar ausente: o contrato confirmado já está no código. No Pages, além do binding D1 e da chave de pseudonimização, configure `PASSWORD_RECORD` conforme a seção da senha. Os tokens das APIs ficam somente no Worker.

## Alcance por período e filtro

A migração `0002_reach.sql` habilita o cache de relatórios exatos. Ao selecionar um período/campanha/anúncio no painel, uma solicitação interna de relatório é registrada no D1, com limitação de gravações repetidas por escopo a cada cinco minutos. Isso **não executa uma importação nem consulta a Meta pelo navegador**. No ciclo seguinte, o mesmo Worker serializado consulta o escopo exato por GET e confirma o valor junto à atualização. Falhas nessa gravação opcional não bloqueiam a leitura dos indicadores já confirmados.

Até a primeira confirmação desse escopo, aparece “—”. Em caso de falha, o valor anterior do mesmo escopo permanece, com horário e aviso. Valores de outro período/filtro nunca são reutilizados. Alcance diário ou de campanhas/anúncios nunca é somado. Cada ciclo atende até 100 escopos solicitados recentemente, para limitar o trabalho.
