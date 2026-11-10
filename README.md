# Eccoa · Gestão dos resultados

Dashboard em português e azul-marinho para tráfego pago e CRM Rugido. Publicação do painel via **GitHub → Cloudflare Pages**, com autenticação em Pages Functions. Sincronização autônoma em Worker exclusivo, Queue e D1, configurados pelo painel Cloudflare. Sem Wrangler e sem dependências npm.

## Estado

Interface, autenticação, persistência, conectores restritos de leitura e fluxo de sincronização implementados. **CRM validado em leitura**: token e workspace Eccoa confirmados, paginação e campos de origem conferidos nas respostas reais. A ativação em produção ainda depende de secrets, D1, fila, Worker e Cron no Cloudflare. A Meta aguarda credencial e validação da conta. Nenhum resultado fictício é exibido como dado real. O símbolo oficial da Rugido foi incluído; a logo da Eccoa está pendente.

## Comandos

```sh
npm run check
npm test
npm run build
npm run dev
```

Use Node 22+. `npm run dev` serve uma prévia local em `http://localhost:8787/__local_preview`, sem tokens, sem importações e sem métricas de demonstração. Esse acesso local de QA não existe no Pages de produção. O teste usa SQLite embutido no Node com sinalizador experimental; a produção usa Cloudflare D1.

`npm run build` gera `dist/` para o Pages e `deploy/eccoa-sync-worker.mjs` para o editor do Worker. A pasta `functions/` permanece na raiz para a implantação automática de Pages Functions.

## Documentação

- [Configuração Cloudflare passo a passo](docs/CLOUDFLARE.md).
- [Contrato das integrações e renovação dos tokens](docs/INTEGRACOES.md).
- [Validação e pendências](docs/VALIDACAO.md).
- [Migração D1](migrations/0001.sql).

Repositório exclusivo: [gabygolom-dev/eccoadashboard](https://github.com/gabygolom-dev/eccoadashboard).

Os tokens ficam apenas nos secrets do Worker. O Pages recebe somente o registro da senha, a chave de pseudonimização e metadados não confidenciais. Não versionar arquivos recebidos com credenciais, PDFs, dumps, nomes, telefones ou conteúdo de mensagens de pacientes.
