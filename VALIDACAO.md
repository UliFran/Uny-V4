# Validação — UniHub V4

Data: **20/10/2026** · Ambiente: `http://127.0.0.1:8767/index.html` (servidor estático local, navegador embutido do Claude Desktop) · dados de demonstração (fictícios).

## Desempenho (medido no navegador, 5 anos de operação simulados)

| Cenário | Dashboard | Estoque atual | Pedidos | Abrir "Novo pedido" | Gravação pequena (1 cliente) | IndexedDB |
|---|---|---|---|---|---|---|
| 800 prod · 300 cli · 600 ped (2.600 mov.) | 7 ms | 3 ms | 3 ms | 37 ms | 6 ms | 2,5 MB |
| 1.500 prod · 1.200 cli · 4.000 ped (13.500 mov.) | 11 ms | 3 ms | 6 ms | 31 ms | 24 ms | 11,9 MB |
| 2.500 prod · 3.000 cli · 12.000 ped (38.500 mov.) | 27 ms | 4 ms | 10 ms | 64 ms | 67 ms | 34,6 MB |

Comparativo com a V3 (mesmos volumes, Node): dashboard 244 ms → 10,3 s e "Estoque atual" 0,5 s → 22 s **por tecla**;
a V3 deixava de gravar acima de ~1.500 pedidos (limite do `localStorage`).
Restaurar um backup de 35 MB (66 mil registros) levou ≈ 8,7 s, incluindo a cópia de segurança antes.

> Medições em PC; no celular espere de 2 a 4× mais, ainda muito abaixo de qualquer atraso perceptível.

## Fluxos verificados (executados de ponta a ponta)

- **Persistência:** dados sobrevivem a recarga; cópia automática criada no primeiro uso.
- **Multi-janela:** gravação em uma janela aparece na outra (BroadcastChannel), inclusive exclusão.
- **Rollback:** `tx` que lança erro devolve o estado e preserva a referência do objeto.
- **Pedido novo:** busca ao digitar, "mais vendidos", total, aviso de falta de estoque.
- **Encomenda a prazo:** confirmação sem estoque (saldo −3, status "Em falta"), 3 parcelas mensais (R$ 141,50), custo gravado no item.
- **Etapas:** confirmado → separado → enviado → entregue pelos botões da lista.
- **Devolução parcial (2 de 5 itens):** reembolso R$ 169,80 abatido das parcelas pendentes (última cancelada, anterior reduzida); líquido R$ 254,70; lucro R$ 146,70.
- **Cancelamento de pedido separado:** estoque devolvido como `devolucao`; parcelas pendentes canceladas.
- **Estoque:** ajuste por inventário (contagem real), sugestão de reposição, entrada com seletor de produto (pré-preenche custo/preço), lista de separação.
- **Painel:** fluxo de pedidos, lucro bruto do mês, alertas e atividade recente.
- Navegação pelas 5 áreas sem erros no console (o único aviso é o registro do service worker, que o navegador embutido não suporta).
- Sintaxe de todos os arquivos JS verificada com `node --check`.

## Bug encontrado e corrigido durante os testes
- `push.apply` com dezenas de milhares de operações estourava a pilha ao restaurar uma base grande — trocado por laço.
- Barra de navegação inferior ficava presa ao topo por causa de `backdrop-filter` no cabeçalho — removido no mobile.

## Não coberto nesta rodada (fazer antes de produção)
- Instalação como PWA e uso offline real (service worker) em Chrome/Android.
- Teste em aparelho Android físico (a emulação do painel embutido não reproduz altura/safe-area).
- Impressão (`print()` em iframe) e abertura do WhatsApp em aparelho real.
- Importação do CSV de 744 produtos na V4 (lógica preservada; só ajustes de preço/URL foram alterados).
- Sincronização com Supabase, login e RLS — próxima etapa.
