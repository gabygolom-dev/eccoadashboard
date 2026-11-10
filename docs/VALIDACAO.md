# Validação em produção — Eccoa

Conferência em 10/11/2026, no fuso `America/Sao_Paulo`. Painel real: [eccoadashboard.pages.dev](https://eccoadashboard.pages.dev/). Código exclusivo: [gabygolom-dev/eccoadashboard](https://github.com/gabygolom-dev/eccoadashboard).

## Infraestrutura publicada

- Pages `eccoadashboard`, branch `main`, publicação automática pelo GitHub e autenticação em Pages Functions.
- D1 `eccoa-dashboard-db`, Worker `eccoa-dashboard-sync` e Queue `eccoa-dashboard-jobs`, exclusivos Eccoa. Migrações 0001–0004 aplicadas.
- Cron `*/15 * * * *` ativo. Disparos reais sucessivos registrados no servidor, incluindo durante horas sem interação do agente. O Worker não oferece importação por HTTP: responde 404.
- Primeira confirmação CRM: **10:42:40**. Primeiro ciclo com reaproveitamento de histórico confirmado às **10:47:24**, reutilizando 1.096 conversas estáveis e consultando oito alteradas. Novos eventos e contatos continuaram chegando nos ciclos posteriores.
- Às **16:03:50**, o CRM acumulava 22 ciclos concluídos; às **16:01:17**, a Meta acumulava 26. Ambas as fontes estavam sem erro e sem execução concorrente ativa. Esses horários são uma fotografia da validação; os horários atuais aparecem no painel.

## Fontes, cobertura e privacidade

Workspace CRM `503dc93f-7b19-408b-b714-63e508ede833`, nome **Eccoa Saúde**, validado antes da importação. Listagem inicial de 3.596 contatos únicos em 40 páginas; 283 linhas repetidas foram deduplicadas. Conversas e mensagens foram paginadas até o fim. Etapas vieram do dicionário real de pipelines. O total de cadastros não equivale aos contatos pagos do período.

Conta Meta fixa `1299657228271057`, nome **ECCOA Saúde**, moeda BRL e fuso `America/Sao_Paulo`. Três anúncios comprovados no CRM corresponderam à mesma conta. Os 38 anúncios disponíveis foram paginados. Nenhuma métrica de outra conta foi consultada e não foi necessário enumerar os outros clientes do token.

API Meta v26.0 e métrica `onsite_conversion.messaging_conversation_started_7d` conferidas nas respostas reais. Atribuição retornada `1d_view_7d_click`, com configuração unificada de atribuição e `action_report_time=impression`. Investimento, impressões, cliques e conversas por anúncio/data reconciliaram com relatórios da conta para Hoje, Ontem, últimos 30 dias e intervalo personalizado. Alcance usa relatórios do período e escopo exatos, sem somar dias ou campanhas.

Consulta de cobertura histórica da Meta com `date_preset=maximum` encontrou atividade entre **02/12/2025 e 10/11/2026**, em duas páginas. A importação iniciada em 01/12/2025 cobre toda a atividade retornada nessa validação.

Somente GET foi utilizado nas duas fontes, com origens fixas, credenciais em cabeçalhos e redirecionamentos recusados. Nenhuma mensagem, contato, etapa, anúncio ou orçamento foi alterado. Tokens estão nos secrets criptografados do Worker. O banco contém somente IDs pseudonimizados, datas, origens, etapas e métricas; nomes, telefones e conteúdo de mensagens de pacientes não são persistidos. Código, HTML e histórico Git foram examinados sem encontrar as credenciais reais fornecidas.

## Contagem e preservação do histórico

O primeiro evento pago de cada contato é escolhido **dentro do intervalo**, antes de aplicar campanha e anúncio. Datas são inclusivas em São Paulo. Cadastro antigo pode contar ao retornar por anúncio; a criação do cadastro não substitui a data da interação.

Conferência publicada em 01/11–09/11: **36 contatos = 19 da campanha CBO + 17 da campanha Wellhub**. Filtro do anúncio `[ES] 1 _ 30.09` retornou 16 contatos. Os resultados da interface coincidiram com a consulta independente ao D1. A soma por campanha reconciliou com o total geral.

Os 263 eventos da primeira confirmação foram preservados após a reimportação, sem duplicação; novos eventos posteriores aumentaram o histórico legitimamente. Origem paga sem data permaneceu separada do período. Não há inferência de origem orgânica nem de campanha sem correspondência comprovada.

Métricas Meta preservam revisões reais e dias anteriores à janela de atualização. Cada ciclo revê o dia atual e os 35 anteriores. Eventos históricos confirmados nunca são apagados pela limpeza dos snapshots temporários.

## Interface, datas e acesso

Interface de produção conferida no navegador: visão geral com dados reais, tabela expansível campanha → conjunto → anúncio, busca, filtros por campanha/anúncio, cartões e tabela dos anúncios e detalhes com IDs reais. Criativo indisponível mostra **“Prévia não carregada”**. Histórico de interações CRM e paginação dos contatos foram conferidos, com identificação anonimizada.

Hoje e intervalo personalizado foram exercitados. Limite dos calendários calculado dinamicamente para 10/11/2026 em São Paulo. Atualizar painel preserva os filtros e consulta a última versão confirmada, sem disparar importações. Hoje aparece como parcial; CRM e Meta têm horários independentes. A consulta automática do navegador ocorre a cada minuto.

Layout móvel de 390 px conferido na produção, incluindo menu recolhido/expandido e navegação para CRM, sem transbordamento horizontal do documento. Tabelas largas têm rolagem própria. Layout desktop e carregamento de CSS, fontes locais e logos também conferidos. Rugido usa o símbolo fornecido; Eccoa usa o símbolo preparado sem o fundo azul do print, com proporção preservada.

Login correto, recusa de senha incorreta e logout com revogação foram exercitados. Sem sessão, `/api/report` retorna 401, scripts privados redirecionam ao login e arquivos de código, `.git` e `.private` retornam 404. CSS de login e logos públicas carregam sem sessão. Sessões expiram em oito horas, com cookies Secure, HttpOnly e SameSite Strict; formulários validam origem e tentativas são limitadas no servidor.

## Plano gratuito e testes

O cliente escolheu manter o plano gratuito. Nenhuma contratação ou mudança de plano foi realizada. Snapshots por página, atualização somente de mudanças, índices, checkpoints e cache das versões de conversas reduzem leituras, gravações e operações de fila. Conversas alteradas são consultadas; uma revisão integral ocorre após 24 horas mesmo sem alteração sinalizada. Snapshots temporários são removidos uma hora depois do término; histórico confirmado permanece.

Amostra de uso no painel D1 durante a validação: cerca de **2,77 milhões de linhas lidas, 62 mil escritas e 12,13 MB armazenados**, incluindo a importação histórica e versões anteriores menos eficientes. Uma otimização adicional substituiu varreduras com funções de janela por agrupamento único e consultas apenas de chaves para conferir cobertura. O relatório do painel também reutiliza uma única seleção deduplicada de contatos para gerar indicadores, evolução, funil e página de contatos, reduzindo leituras a cada minuto. A fila registrava cerca de 5 mil operações na amostra de 24 horas, incluindo a carga histórica inicial. O uso deve continuar sendo acompanhado conforme cresçam contatos, mensagens e acessos; o plano gratuito tem cotas e não oferece capacidade ilimitada.

**38 testes automatizados aprovados**, além das verificações de sintaxe, transporte GET e build. Os testes usam dados sintéticos somente em SQLite na memória. Cobrem seleção antes dos filtros, datas inclusivas, deduplicação, histórico, revisões Meta, confirmação transacional, retentativas/checkpoints, cache, snapshots compactos e autenticação. Falhas são simuladas em ambiente isolado e preservam os dados confirmados; credenciais de produção não foram revogadas para provocar falhas.

## Limitações reais e manutenção

- Vendas confirmadas, faturamento, conversão em venda e ROAS indisponíveis: não há fonte validada para esses resultados. Uma etapa com nome “Venda” não é tratada como receita comprovada.
- Contatos com origem paga sem evidência datada ficam fora dos totais por período; rastreamento depende do histórico disponibilizado pelo CRM.
- Imagens de criativos não retornadas pela integração aparecem como prévia não carregada.
- Alcance de um novo escopo pode ficar indisponível até o próximo ciclo; o valor de outro escopo não é reaproveitado.
- Alterações históricas do CRM sem mudança nos marcadores operacionais podem depender da revisão integral diária.
- Renove tokens no Worker e preserve a chave de pseudonimização. Consulte [manutenção Cloudflare](CLOUDFLARE.md) e [contratos e renovação dos tokens](INTEGRACOES.md). Alterações no Worker separado exigem publicar o bundle atualizado pelo editor Cloudflare; o GitHub publica automaticamente o Pages.
