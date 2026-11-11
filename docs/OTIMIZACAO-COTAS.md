# Redução do consumo D1 — 11/11/2026

O cliente informou consumo de 4,65 milhões de leituras e 82,62 mil gravações no dia UTC de 10/11. Na consulta parcial de 11/11: 2,19 milhões de leituras e 24,79 mil gravações. Esses valores representam o uso já realizado e não podem ser reduzidos retroativamente.

## Diagnóstico

A tabela de consultas do Cloudflare apontou três operações dominantes de contatos na janela consultada:

| Operação antiga | Execuções | Leituras acumuladas | Gravações |
| --- | ---: | ---: | ---: |
| Comparação/publicação de contatos e etapas | 59 | 918,63 mil | 0 |
| Redefinição de etapa para IDs ausentes | 60 | 729,06 mil | 0 |
| Conferência de cobertura dos contatos | 60 | 471,72 mil | 0 |

Mesmo sem alterações, a expansão de páginas JSON no SQLite, o agrupamento e a varredura da tabela repetiam leituras. O tráfego HTTP dos Workers não explica sozinho o custo: consultas sem visitantes também contam para as cotas de D1.

## Alteração publicada

- Frequência mantida em **15 minutos**, sem mudar plano, tokens ou acesso às fontes.
- Paginação da API e validação de cobertura mantidas integralmente. Páginas compactas são lidas pelo Worker, que une IDs e trata duplicados em memória.
- Contatos e etapas comparados com um snapshot canônico confirmado. A ordem das páginas ou das etapas não provoca regravação desnecessária.
- Sem mudanças: não há revarredura da tabela inteira de contatos, nem upsert de todos os cadastros, nem regravação do snapshot.
- Com mudanças: somente os IDs alterados são enviados ao banco. Cadastros que saíram da listagem perdem apenas a etapa atual, preservando IDs e eventos históricos.
- O snapshot contém apenas IDs pseudonimizados, etapas do dicionário validado e indicação de origem paga. Confirmação da fonte, contatos e cache avançam na mesma transação; falhas preservam o estado anterior.
- A primeira execução inicializa o cache a partir dos dados confirmados. Um cache maior que 1,5 MB usa comparação direta com os dados confirmados, respeitando o limite de valor do banco.
- Metadados de anúncios Meta também usam snapshots por página. IDs já consultados na listagem não geram registros temporários individuais de fallback; referências históricas ausentes continuam preservadas. O agrupamento não altera nomes, status, formatos, IDs ou métricas.
- Evidência histórica de origem paga sem data não é removida pela simples ausência do sinal numa reimportação posterior.

## Verificação

45 testes passaram, além de sintaxe, build e bundle do Worker. Foram exercitados:

- 4.000 contatos estáveis: 41 linhas de páginas compactas retornadas na preparação, sem consulta à tabela inteira de contatos e sem instrução de regravação. Essa medição local não é uma medição de cobrança D1.
- Dados legados e páginas novas, IDs repetidos e união do sinal pago.
- Várias etapas por contato e alteração na ordem de retorno.
- Mudança real de etapa, cadastro ausente e preservação de evidência sem data.
- Falha transacional sem avanço do cache.
- Cache acima do limite com comparação segura e sem perda de contatos.
- Importação Meta com 38 anúncios em uma página temporária, referência histórica ausente e compatibilidade com snapshots legados.

A medição em produção deve comparar ciclos concluídos da nova versão. O total diário anterior inclui carga histórica e versões antigas. Não extrapolar uma redução percentual dos testes locais para o dia inteiro.

## Manutenção

Worker separado: `eccoa-dashboard-sync`. O bundle `deploy/eccoa-sync-worker.mjs` precisa ser publicado pelo editor Cloudflare após mudanças no conector. O GitHub publica o Pages automaticamente. Não são necessários novos secrets, migrações ou permissões.

As cotas diárias gratuitas são da conta e reiniciam às 00:00 UTC. Acompanhe linhas lidas e escritas, além de filas e execução, conforme [a documentação oficial D1](https://developers.cloudflare.com/d1/platform/pricing/). Não autorizar cobrança automaticamente.
