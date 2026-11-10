# Situação da validação

## Implementado e verificado localmente

- Datas inclusivas no fuso America/Sao_Paulo e limite dinâmico até hoje.
- Primeiro evento pago por contato no intervalo, ANTES dos filtros.
- Deduplicação por ID de evento e preservação de eventos históricos.
- Contatos sem campanha preservados; sem data separados.
- Custos e taxas pelos totais; conversas sem soma de métricas sobrepostas.
- Transporte upstream GET, origem fixa, redirecionamentos bloqueados e tokens fora das URLs.
- Publicação transacional por fonte; falhas preservam a última confirmação.
- Revisões Meta preservadas sem duplicação de métricas atuais.
- Senha no servidor, sessão com expiração, cookies Secure/HttpOnly/SameSite, CSRF, limitação de tentativas e logout revogável.
- Recursos privados e APIs bloqueados sem sessão; arquivos do código bloqueados.
- Bloqueio de ciclos ativos duplicados e checkpoints persistentes.

Os testes usam dados sintéticos SOMENTE em `tests/`, em SQLite na memória. O painel e os arquivos publicados não contêm uma demonstração preenchida.

## Interface conferida no navegador

Prévia local sem dados fictícios conferida em 09/11/2026: visão geral, Campanhas e Anúncios; Hoje e intervalo personalizado até a data atual; botão Atualizar preservando o período; viewport móvel de 390 px sem transbordamento horizontal e viewport desktop de 1440 px. Nenhuma conta real foi acessada nessa conferência.

## CRM e marca Rugido conferidos com os arquivos fornecidos

Em 09/11/2026: token aceito em GET com `api_access_token`; workspace Eccoa confirmado por ID e nome. Cobertura completa de contatos conferida por IDs únicos até a página vazia, inclusive além do final indicado pela API. Todas as conversas e todas as páginas de mensagens disponíveis foram percorridas. Metadados `origem_anuncio.ad_id`, data original `external_created_at` e identificador externo foram conferidos em mensagens recebidas. Dicionário de etapas consultado em GET `/pipelines`.

O símbolo oficial Rugido foi copiado integralmente do arquivo fornecido para `public/assets/rugido-simbolo-oficial.png`. Não houve redesenho, substituição pela letra R, corte ou alteração de proporção.

A auditoria não importou dados na Cloudflare. Esses testes de leitura local não comprovam atualização automática no servidor, autenticação na URL publicada ou integração Meta.

## Pendente de acesso/material e validação em produção

- Senha privada configurada no servidor.
- Secrets CRM e Meta instalados no Worker; senha privada configurada no Pages.
- Primeiro ciclo do conector CRM na infraestrutura Cloudflare, com o contrato real já incluído.
- Bindings de D1, fila, Worker e Cron configurados pelo responsável no painel Cloudflare.
- Primeiro ciclo real, ciclo automático seguinte e seus horários confirmados.
- Comparação de métricas reais por período/campanha/anúncio.
- Login e bloqueios testados na URL de produção.

Não há horário de atualização real a informar antes dessas confirmações. A previsão do próximo quarto de hora não comprova o Cron ativo. Alcance e vendas permanecem indisponíveis pelos motivos documentados, sem substituição por números fictícios.

## Meta e logo Eccoa

Token aceito exclusivamente por GET na conta `ECCOA Saúde`, identificada a partir de anúncio comprovado no CRM. Os anúncios de referência cruzados corresponderam à mesma conta; não listamos contas de outros clientes. Versão v26.0 confirmada no SDK oficial e nas respostas reais.

Paginação de anúncios e insights exercitada com páginas pequenas; totais diários por anúncio reconciliados com o relatório da conta em Hoje, Ontem, últimos 30 dias e intervalo personalizado. Conversas iniciadas conferidas em `actions` e `results`, separadas de cliques e outras ações de mensagens. Alcance consultado em escopos exatos da conta, campanha e anúncio. Atribuição retornada pelo relatório preservada separadamente da janela atual dos conjuntos.

Login, carregamento da logo e logout com redirecionamento e revogação de sessão também conferidos no navegador local. A política de referrer permite origem nas submissões dentro do próprio site, mantendo o bloqueio de formulários de origem externa.

Símbolo Eccoa preparado a partir do print de perfil enviado, com remoção do círculo azul e das bordas do print. O PNG transparente em `public/assets/eccoa.png` preserva a proporção do símbolo e aparece no menu, cabeçalho e login. Detalhes da edição em `docs/LOGO-ECCOA.md`. As credenciais não foram incluídas em arquivos versionados, HTML ou artefatos de publicação.

Essas conferências locais não comprovam instalação dos secrets, execução do Cron, login ou publicação funcional na Cloudflare. O usuário informou que ainda configurará os recursos pelo guia.

## Correção de publicação dos arquivos visuais

Em produção foram observadas respostas 404 em `/login.css` e `/assets/eccoa.png`, apesar dos arquivos presentes em `public/` e `dist/`. O build passou a espelhar apenas os arquivos públicos na raiz, mantendo a saída recomendada `dist/`, para compatibilidade com o diretório estático usado pelo projeto Pages.

CSS, tipografia local e logos têm uma lista explícita de rotas públicas, sem depender de cookie. APIs, páginas do painel, JavaScript privado e arquivos de código/configuração continuam protegidos. Nenhum token ou dado de contatos foi adicionado aos arquivos estáticos.
