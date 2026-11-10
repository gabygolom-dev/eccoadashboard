# Publicação Eccoa pelo GitHub, sem Wrangler

Este projeto usa Cloudflare Pages + Pages Functions para o painel. A sincronização usa um Worker separado, D1 e Queue. **Pages sozinho não executa Cron Triggers.** Todos os recursos abaixo são exclusivos da Eccoa.

## 1. Pages existente

No projeto **eccoadashboard**, conectado a `gabygolom-dev/eccoadashboard`:

- Branch de produção: `main`.
- Framework: nenhum.
- Comando de build: `npm run build`.
- Diretório de saída: `dist`.
- Diretório raiz: raiz do repositório.
- Node: 22 ou superior (`NODE_VERSION=22`).

A pasta `functions/` é implantada pelo Pages. Não publique apenas arquivos estáticos: isso retiraria a proteção do servidor. `_routes.json` deve permanecer com todas as rotas incluídas. A URL oficial deve ser copiada do projeto Pages após o deploy; não presumimos que um endereço esteja ativo só pelo nome do projeto.

## 2. Banco exclusivo

Em Storage & databases → D1, crie **eccoa-dashboard-db**. No console SQL do próprio banco, execute todo o conteúdo de [`migrations/0001.sql`](../migrations/0001.sql). Executar novamente é seguro (IF NOT EXISTS/INSERT OR IGNORE).

No Pages → Settings → Bindings, adicione um D1 binding:

- Nome: `ECCOA_DB`.
- Banco: `eccoa-dashboard-db`.

Use somente o banco Eccoa. Após alterar bindings/secrets, faça novo deployment pelo Pages (Retry deployment) para aplicá-los. Não habilite previews com credenciais de produção de forma indiscriminada.

## 3. Senha e anonimização

No Pages → Settings → Variables and Secrets, configure como **secrets criptografados**, na produção:

- `PASSWORD_RECORD`: registro PBKDF2 da senha privada do cliente.
- `PSEUDONYM_KEY`: chave aleatória exclusiva Eccoa com pelo menos 32 caracteres.

A senha deve ter pelo menos 14 caracteres. O script local `scripts/password-record.mjs` lê somente `dashboardPassword` de um JSON protegido fora do repositório. Em um terminal privado no macOS, use `node scripts/password-record.mjs /caminho/protegido/eccoa.json | pbcopy`, depois cole em `PASSWORD_RECORD`. Não inclua senha na linha de comando nem imprima o arquivo protegido.

A chave `PSEUDONYM_KEY` deve ser a MESMA no Pages e no Worker. Não a rotacione sem um plano de migração dos IDs históricos. Ela não pode ser reutilizada de outro cliente. Não é necessário colocar os tokens Meta/Rugido no Pages: somente o Worker precisa deles.

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

A aplicação já grava checkpoints, usa lease por execução, impede ciclos ativos duplicados e aplica retentativas com atraso. A Queue continua o processamento mesmo com o painel fechado. Cada mensagem processa uma página ou etapa. O próximo Cron também reenfileira ciclos ativos caso tenha ocorrido interrupção no envio de uma continuação. Sem a Queue, a atualização automática não está pronta.

No Worker → Settings → Triggers, adicione Cron `*/15 * * * *`. Esse Cron dispara em UTC nos minutos 00, 15, 30 e 45, equivalente aos mesmos minutos em São Paulo. A aplicação registra datas de contato no fuso America/Sao_Paulo.

Desative logs de conteúdo das requisições/respostas e não ative captura de mensagens de pacientes. O código não registra corpos de respostas nem tokens.

## 6. Configuração não confidencial do Pages

- `CLIENT_NAME=Eccoa Saúde`.
- `CRM_WORKSPACE_NAME`: nome exato validado do workspace Eccoa.
- `META_ACCOUNT_ID`: apenas números, da conta validada Eccoa.
- `META_API_VERSION`: versão confirmada na documentação oficial/resposta real.
- `BRANDS_READY=true` somente depois de colocar as logos oficiais em `public/assets/rugido.svg` e `public/assets/eccoa.png`, com proporção original. Se os arquivos fornecidos tiverem outros formatos, ajustar os caminhos em `public/app.js`; não converter uma marca raster para um SVG falso.

Essas variáveis apenas identificam as conexões no painel; não concedem acesso às APIs.

## 7. Validação em produção (obrigatória antes de aceitar a entrega)

1. Navegação privada: login acessível, `/api/report`, `/app.js` e assets privados bloqueados sem sessão; arquivos de código/configuração retornam 404.
2. Senha correta permite acesso; senha incorreta é recusada; sexta tentativa no mesmo IP em 15 minutos recebe 429; logout invalida a sessão no banco.
3. Após o primeiro Cron, `settings.lastCron` deve mudar. `runs` deve avançar em páginas e concluir para cada fonte. Confira ambos os horários em Configurações e na visão geral.
4. Confirme no D1 `sources.identity_json` o workspace e a conta Eccoa antes de aceitar os dados. Os conectores abortam quando ID ou nome não correspondem à configuração autorizada.
5. Compare período, campanha e anúncio com CRM/Meta. A soma de contatos das campanhas deve ser o total; contatos sem campanha permanecem no total.
6. Observe um segundo disparo automático real, sem navegador aberto, e confira os novos horários. Um horário futuro exibido é só previsão, não comprovação de agendamento.
7. Teste falha em ambiente isolado, nunca revogando uma credencial de outro cliente; dados confirmados devem permanecer. Os testes automatizados locais verificam essa propriedade transacional.
8. Anote URL real, commit, horários confirmados e limitações em `VALIDACAO.md`.

A infraestrutura tem custos e limites da conta Cloudflare. Nenhum recurso de outro cliente deve ser renomeado, compartilhado ou reutilizado. Backups do banco contêm apenas dados minimizados; proteja o acesso administrativo.
