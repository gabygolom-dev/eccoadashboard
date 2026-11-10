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

## Pendente de acesso/material e validação em produção

- Logos oficiais Rugido e Eccoa.
- Senha privada configurada no servidor.
- Tokens protegidos, workspace Rugido e conta Meta Eccoa confirmados.
- Contrato JSON real do Rugido e dicionário oficial das etapas.
- Versão vigente da API Meta e action_type de conversas verificados oficialmente e na resposta real.
- Bindings de D1, fila, Worker e Cron configurados pelo responsável no painel Cloudflare.
- Primeiro ciclo real, ciclo automático seguinte e seus horários confirmados.
- Comparação de métricas reais por período/campanha/anúncio.
- Login e bloqueios testados na URL de produção.

Não há horário de atualização real a informar antes dessas confirmações. A previsão do próximo quarto de hora não comprova o Cron ativo. Alcance e vendas permanecem indisponíveis pelos motivos documentados, sem substituição por números fictícios.
