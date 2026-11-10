# Eccoa · Gestão dos resultados

Dashboard em português e azul-marinho para tráfego pago e CRM Rugido. Publicação do painel via **GitHub → Cloudflare Pages**, com autenticação em Pages Functions. Sincronização autônoma em Worker exclusivo, Queue e D1, configurados pelo painel Cloudflare. Sem Wrangler e sem dependências npm.

## Estado

**Produção ativa:** [eccoadashboard.pages.dev](https://eccoadashboard.pages.dev/), com senha validada no servidor. CRM Rugido e Meta confirmados nas contas Eccoa; primeira importação e ciclos automáticos reais concluídos na Cloudflare em 10/11/2026. Paginação, deduplicação, origem datada, métricas e atribuição conferidas nas respostas reais. Nenhum resultado fictício é exibido como dado real.

O cliente escolheu o plano gratuito. A sincronização usa snapshots compactos por página, grava somente mudanças e reutiliza históricos de conversas com versão estável, com revisão integral diária. Worker exclusivo `eccoa-dashboard-sync`, fila `eccoa-dashboard-jobs` e banco `eccoa-dashboard-db`. Cron `*/15 * * * *`; o painel consulta a última versão confirmada a cada minuto.

O símbolo Rugido fornecido foi preservado; o símbolo Eccoa foi preparado a partir do print enviado, removendo o fundo do perfil. Vendas, faturamento e ROAS continuam indisponíveis, pois nenhuma fonte real de vendas foi validada. Prévias de anúncios não carregadas são indicadas explicitamente.

## Comandos

```sh
npm run check
npm test
npm run build
npm run dev
```

Use Node 22+. `npm run dev` serve uma prévia local em `http://localhost:8787/__local_preview`, sem tokens, sem importações e sem métricas de demonstração. Esse acesso local de QA não existe no Pages de produção. O teste usa SQLite embutido no Node com sinalizador experimental; a produção usa Cloudflare D1.

`npm run build` gera `dist/` para o Pages e espelha exclusivamente os arquivos públicos na raiz para projetos Pages que publicam a raiz do repositório e `deploy/eccoa-sync-worker.mjs` para o editor do Worker. A pasta `functions/` permanece na raiz para a implantação automática de Pages Functions.

## Documentação

- [Configuração Cloudflare passo a passo](docs/CLOUDFLARE.md).
- [Contrato das integrações e renovação dos tokens](docs/INTEGRACOES.md).
- [Validação em produção](docs/VALIDACAO.md).
- [Migração D1 básica](migrations/0001.sql).
- [Migração do cache de alcance](migrations/0002_reach.sql).
- [Migração do cache de conversas](migrations/0003_conversation_cache.sql).
- [Índices para o plano gratuito](migrations/0004_free_plan_indexes.sql).

Repositório exclusivo: [gabygolom-dev/eccoadashboard](https://github.com/gabygolom-dev/eccoadashboard).

Os tokens ficam apenas nos secrets do Worker. O Pages recebe somente o registro da senha, a chave de pseudonimização e metadados não confidenciais. Não versionar arquivos recebidos com credenciais, PDFs, dumps, nomes, telefones ou conteúdo de mensagens de pacientes.
