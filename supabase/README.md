# Supabase — sincronização do UniHub V4

O UniHub V4 é **local-first**: o app lê e grava no IndexedDB do aparelho e funciona
offline. O Supabase entra como **camada de sincronização por registro**, não como
fonte única da verdade. Isso evita as RPCs transacionais para cada operação (a
confirmação de venda, por exemplo, já é atômica no aparelho) e mantém o app rápido
mesmo sem sinal na casa do cliente.

Criado por UliFran / Ulisystem® · desenvolvido com Claude (Anthropic).

## 1. Criar o projeto
1. Crie o projeto no [Supabase](https://supabase.com).
2. **SQL Editor** → execute `supabase/schema.sql` inteiro.
3. Crie a sua conta (o trigger cria perfil, workspace, vínculo `owner` e referências).
4. **Desative o cadastro público**: *Authentication → Providers → Email → Allow new users to sign up = off*.
5. Copie a **Project URL** e a **anon public key** para `js/config.js`.
   A `service_role` key **nunca** vai para o front nem para o GitHub.

## 2. O que o schema entrega (alinhado à V4)
- Workspaces, membros e perfis com RLS (membros leem; owner/editor escrevem).
- Catálogo, estoque (`entrada`, `saida`, `ajuste`, `devolucao`), vendas com etapas
  (`rascunho → confirmado → separado → enviado → entregue`, `devolvido`, `cancelado`),
  recebimento (`agora/entrega/prazo`), parcelas, devoluções (`returns jsonb`),
  compras, financeiro, campanhas e contadores.
- `tombstones` (exclusões) e `updated_at` automático em todas as tabelas — base do sync.
- Índices `pg_trgm` para busca por nome/código e índices para vendas por cliente/status.
- Views `v_product_stock`, `v_low_stock`, `v_client_stats` (com `security_invoker`).
- Funções internas (`seed_workspace_reference`, `handle_new_user`) sem permissão de execução pela API.

## 3. Como o sync vai funcionar (etapa de amanhã)
O app já grava, em cada registro, `updatedAt` e, nas exclusões, um tombstone local.

1. **Push:** enviar para o Supabase os registros alterados desde o último sync (`upsert` por `id`) e os tombstones.
2. **Pull:** buscar linhas com `updated_at > último_sync`, ordenadas por `updated_at, id`, em páginas; aplicar localmente.
3. **Conflito:** "última edição vence" por registro, usando o `updated_at` carimbado pelo **servidor** (trigger) — evita erro de relógio do celular.
4. **Estoque:** as movimentações são imutáveis (só entram), então convergem sem conflito; o saldo é sempre recalculado.
5. **Numeração de pedidos:** definir prefixo por aparelho (ex.: `PED-C-…`/`PED-P-…`) ou numerar no servidor ao sincronizar.

## 4. Pontos de atenção na migração
- O front guarda datas vazias como `''`; o Postgres exige `null` em colunas `date/timestamptz` — mapear na gravação.
- `finance_entries.amount > 0`: pedido com total R$ 0 não gera receita (o app já respeita isso).
- `qty` é `integer`; o app já arredonda quantidades.
- Paginação sempre com `.order()` estável (o adaptador de leitura já faz).
- Carregar o catálogo e movimentações recentes localmente e buscar o restante sob demanda mantém o app leve.

## 5. Imagens
O CSV da Natura traz URLs externas; o app só as armazena. Para imagens próprias, crie o bucket
`product-images` com políticas por workspace.
