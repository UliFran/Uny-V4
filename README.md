# UniHub V4

Gestão local-first para vendas diretas de cosméticos: **estoque, clientes,
pedidos, campanhas e financeiro** em um app que roda no PC (Windows) e no celular
(Android), funciona **sem internet** e está preparado para sincronizar com o
**Supabase**.

> **Créditos** — criado por **UliFran / Ulisystem®**, com desenvolvimento
> assistido por **Claude** (Anthropic). A V4 evolui o "Hub Silene v2" (visao-deepseek)
> a partir de uma análise de funcionalidade, desempenho e segurança.

---

## Como rodar

Sem build e sem dependências. Sirva a pasta como site estático:

```powershell
cd C:\Users\umfra\Documents\Projetos\teste\visao-Claude
python -m http.server 8767 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8767/index.html`. Em **Configurações** há a opção de
carregar dados de demonstração (fictícios).

> O service worker (uso offline / instalação como app) só funciona em
> `http://localhost`, `http://127.0.0.1` ou HTTPS — nunca via `file://`.

---

## O que mudou da V3 (Hub Silene v2) para a V4

### Dados e desempenho
| Problema da V3 | Solução na V4 |
|---|---|
| Tudo em um único `localStorage` (~5 MB; parava de gravar em torno de 1.500 pedidos) | **IndexedDB** com gravação **por registro** (só o que mudou). Testado com 12.000 pedidos / 38.500 movimentos (≈35 MB). |
| Dashboard 10 s, "Estoque atual" 22 s por tecla (cenário de 5 anos) | **Índices em cache** (saldo, tags, clientes): dashboard ≈ 27 ms, estoque atual ≈ 4 ms. |
| Duas abas se sobrescreviam | **BroadcastChannel**: as janelas se mantêm iguais; gravação por registro evita perda. |
| Sem backup automático; "Apagar tudo" sem rede de segurança | **Cópias automáticas** (1 por dia + antes de restaurar/apagar), restauráveis em Configurações; lembrete de backup após 7 dias. |
| Sem proteção contra limpeza do navegador | Pede **armazenamento persistente**; mostra o uso real do armazenamento. |
| Não instalável | **PWA**: `manifest` + `service worker` + ícones. Instale no Android/Windows. |

### Vendas (fluxo real de captação → separação → envio)
- **Busca de produto ao digitar** + atalhos "mais vendidos" (no lugar do `<select>` com 744 itens).
- Etapas: **rascunho → confirmado → separado → enviado → entregue** (e cancelado / devolvido).
- **Encomenda**: confirmar sem estoque deixa o saldo negativo, que vira "Em falta" e entra em **Sugerir reposição**.
- **Recebimento** separado do pedido: *na hora*, *na entrega* ou *a prazo em até 12 parcelas mensais*; "Receber" por parcela.
- **Devolução** (total/parcial) após a entrega, com reembolso proporcional ao desconto e ajuste das parcelas pendentes.
- **Lucro bruto** por pedido e no mês (custo gravado no momento da venda).
- **Resumo por WhatsApp / copiar** (com chave Pix) e **impressão via iframe** (funciona no Android).
- **Lista de separação** agregada por produto e por pedido.
- Painel inicial com o **fluxo de pedidos** (a separar, a enviar, a caminho, a receber, a comprar).

### Estoque
- **Ajuste de estoque** (inventário, perda/avaria, brinde/amostra, acerto).
- Devolução de venda é um tipo próprio (`devolucao`) e não "entrada".
- Não é mais possível **reabrir compra** ou **excluir entrada** se o saldo ficar negativo.
- Editar uma entrada antiga não reescreve mais o custo/preço atuais do produto.
- Removido o alerta "Abaixo de 50%" (gerava ruído); adicionado "Em falta (encomenda)".

### Correções e segurança
- `toNumber` aceita `1.234,56`; `daysBetween` não muta datas; `addDays` não desloca fuso.
- CSV exportado neutraliza fórmulas (`=`, `+`, `-`, `@`).
- Impressão escapa todos os campos; backups importados são validados registro a registro.
- Importação de catálogo preserva o seu preço de revista (opção explícita) e só aceita links `http(s)`.
- Campanha "Sem comprar há 90 dias" só considera quem já comprou.
- Aviso de **telefone duplicado** no cadastro de cliente.
- **CSP** no `index.html`; workflow publica **apenas** os arquivos do app.
- Rollback agora restaura o estado preservando a mesma referência (telas não ficam "fantasma").

### Visual
- Barra de navegação **inferior** no celular (estilo app), alvos de toque maiores, seletor de produto em tela cheia.
- Novo ícone, cartões e KPIs com microinterações, painel de fluxo de pedidos, chip de aviso de backup.

---

## Arquitetura de dados (resumo)

```
 UI (módulos)  ──tx(fn)──▶  estado em memória  ──diff por registro──▶  IndexedDB
                                │                                  ├─ <tabelas>   (1 registro por chave)
                                │ índices em cache                 ├─ tombstones  (exclusões, p/ sync)
                                ▼                                  ├─ kv          (meta, settings, counters)
                       saldo / tags / clientes                     └─ backups     (cópias automáticas)
```

- Toda alteração passa por `DB.tx(fn)`; se `fn` lançar erro, tudo volta ao último estado confirmado.
- Registros alterados recebem `updatedAt`; excluídos geram *tombstone* — base do sync.
- O saldo **nunca** é editado: é a soma das movimentações (`entrada`, `saida`, `ajuste`, `devolucao`).

## Próximo passo: Supabase + GitHub
1. Rodar `supabase/schema.sql` (já alinhado ao modelo V4: etapas, parcelas, devolução, tombstones, índices `pg_trgm`).
2. Desativar o cadastro público no Supabase após criar a sua conta.
3. Tela de **login** + sincronização por registro (push das mudanças locais, pull por `updated_at`).
4. Publicar no GitHub Pages (workflow incluso) e **medir o desempenho online**.

Detalhes em [`supabase/README.md`](supabase/README.md). Registro dos testes em [`VALIDACAO.md`](VALIDACAO.md).

## Limitações conhecidas (V4 local)
- Dados só neste aparelho até a sincronização; PC e celular ainda são bases separadas (o backup JSON é a ponte).
- Sem login/multiusuário (por desenho, uso individual).
- Sem leitura de código de barras pela câmera, taxa de cartão e pagamento parcial livre (use parcelas).
- Fontes do Google ainda vêm de CDN (com *fallback* do sistema); incluí-las localmente é um próximo ajuste.
- O service worker não pôde ser exercitado no navegador embutido usado nos testes; valide a instalação no Chrome/Android.

## Estrutura

```text
visao-Claude/
  index.html · manifest.webmanifest · sw.js
  css/app.css
  js/
    config.js  utils.js  db.js  ui.js  app.js  import.js
    modules/   dashboard · estoque · clientes · pedidos · financeiro
    data/      supabase-adapter.js   (esqueleto de leitura, com paginação estável)
  supabase/    schema.sql · README.md
  assets/      ícones PWA · hero
  .github/workflows/pages.yml
```

---

© UliFran / Ulisystem® · UniHub V4 · construído com Claude (Anthropic).
