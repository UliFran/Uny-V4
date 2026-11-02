-- ============================================================================
-- UniHub V4 — schema Supabase (PostgreSQL)
-- ----------------------------------------------------------------------------
-- Backend de SINCRONIZAÇÃO do UniHub V4 (local-first). O app grava no IndexedDB
-- do aparelho e, com login, replica por registro (updated_at + tombstones).
-- Criado por UliFran / Ulisystem® · desenvolvido com Claude (Anthropic).
--
-- Como usar:
--   1. Crie um projeto no Supabase.
--   2. Abra o SQL Editor e execute este arquivo inteiro.
--   3. Publique o front no GitHub Pages.
--   4. Implemente/ative js/data/supabase-adapter.js e mude dataMode em config.js.
--
-- Segurança:
--   - RLS está ligado em todas as tabelas de dados.
--   - O front usa somente a anon key; nunca a service_role key.
--   - Um workspace é criado automaticamente no primeiro cadastro.
--   - IMPORTANTE: após criar a sua conta, DESATIVE o cadastro público em
--     Authentication > Providers > Email > "Allow new users to sign up".
--     Caso contrário qualquer pessoa com a URL consegue criar conta/workspace.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Perfis, workspaces e membros
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'UniHub',
  store_name text not null default 'UniHub',
  consultant text not null default '',
  pix_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Funções de autorização (security definer para não recursar no RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_workspace(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target
      and m.user_id = auth.uid()
      and m.role in ('owner', 'editor')
  );
$$;

create or replace function public.is_workspace_owner(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target
      and w.owner_id = auth.uid()
  );
$$;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create table if not exists public.brands (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists brands_workspace_nome_uq
  on public.brands (workspace_id, lower(nome));

create table if not exists public.categories (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists categories_workspace_nome_uq
  on public.categories (workspace_id, lower(nome));

create table if not exists public.tags (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  tipo text not null check (tipo in ('tipo_produto', 'familia_olfativa', 'linha')),
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tags_workspace_tipo_nome_uq
  on public.tags (workspace_id, tipo, lower(nome));

create table if not exists public.clients (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  nome text not null,
  phone text not null default '',
  email text not null default '',
  birthday date,
  city text not null default '',
  tags text[] not null default '{}',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_workspace_nome_idx
  on public.clients (workspace_id, nome);
create index if not exists clients_nome_trgm_idx
  on public.clients using gin (nome gin_trgm_ops);
create index if not exists clients_workspace_birthday_idx
  on public.clients (workspace_id, birthday);

create table if not exists public.products (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id text references public.brands (id) on delete set null,
  category_id text references public.categories (id) on delete set null,
  codigo text not null,
  nome text not null,
  nome_tecnico text not null default '',
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  active boolean not null default true,
  description text not null default '',
  image_url text not null default '',
  product_url text not null default '',
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_workspace_codigo_uq
  on public.products (workspace_id, upper(codigo));
create index if not exists products_workspace_nome_idx
  on public.products (workspace_id, nome);
create index if not exists products_nome_trgm_idx
  on public.products using gin (nome gin_trgm_ops);
create index if not exists products_codigo_trgm_idx
  on public.products using gin (codigo gin_trgm_ops);

create table if not exists public.product_tags (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  tag_id text not null references public.tags (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (product_id, tag_id)
);
create index if not exists product_tags_tag_idx
  on public.product_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------------

create table if not exists public.sales (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  number text not null,
  client_id text references public.clients (id) on delete set null,
  client_name text not null default 'Consumidor final',
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  payment_method text not null default 'pix'
    check (payment_method in ('pix', 'dinheiro', 'cartao', 'transferencia', 'fiado')),
  receipt text not null default 'agora'
    check (receipt in ('agora', 'entrega', 'prazo')),
  installments integer not null default 1 check (installments between 1 and 12),
  returns jsonb not null default '[]'::jsonb,
  due_date date,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'confirmado', 'separado', 'enviado', 'entregue', 'devolvido', 'cancelado')),
  notes text not null default '',
  status_history jsonb not null default '[]'::jsonb,
  confirmed_at timestamptz,
  separated_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount <= subtotal)
);
create unique index if not exists sales_workspace_number_uq
  on public.sales (workspace_id, number);
create index if not exists sales_workspace_created_idx
  on public.sales (workspace_id, created_at desc);
create index if not exists sales_workspace_client_idx
  on public.sales (workspace_id, client_id);
create index if not exists sales_workspace_status_idx
  on public.sales (workspace_id, status);

create table if not exists public.sale_items (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sale_id text not null references public.sales (id) on delete cascade,
  product_id text references public.products (id) on delete set null,
  codigo text not null default '',
  nome text not null default '',
  qty integer not null check (qty > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  check (discount <= unit_price * qty)
);
create index if not exists sale_items_product_idx
  on public.sale_items (product_id);
create index if not exists sale_items_sale_idx
  on public.sale_items (sale_id, position);

-- ---------------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------------

create table if not exists public.purchase_orders (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  number text not null,
  status text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  total numeric(12, 2) not null default 0 check (total >= 0),
  notes text not null default '',
  closed_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists purchase_orders_workspace_number_uq
  on public.purchase_orders (workspace_id, number);

create table if not exists public.purchase_order_items (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  purchase_order_id text not null references public.purchase_orders (id) on delete cascade,
  product_id text references public.products (id) on delete set null,
  codigo text not null default '',
  nome text not null default '',
  qty integer not null check (qty > 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  position integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists purchase_order_items_order_idx
  on public.purchase_order_items (purchase_order_id, position);

create table if not exists public.purchase_draft_items (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  qty integer not null check (qty > 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Movimentações de estoque
-- ---------------------------------------------------------------------------

create table if not exists public.stock_movements (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  type text not null check (type in ('entrada', 'saida', 'ajuste', 'devolucao')),
  quantity integer not null,
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  cycle text not null default '',
  expiry date,
  supplier text not null default '',
  note text not null default '',
  sale_id text references public.sales (id) on delete set null,
  purchase_order_id text references public.purchase_orders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type = 'ajuste' or quantity > 0)
);
create index if not exists stock_movements_product_idx
  on public.stock_movements (workspace_id, product_id, created_at);
create index if not exists stock_movements_sale_idx
  on public.stock_movements (sale_id);
create index if not exists stock_movements_order_idx
  on public.stock_movements (purchase_order_id);

-- ---------------------------------------------------------------------------
-- Financeiro
-- ---------------------------------------------------------------------------

create table if not exists public.finance_entries (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null check (type in ('receita', 'despesa')),
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  installment integer,
  installments integer,
  category text not null default 'Outros',
  due_date date not null default current_date,
  paid_at date,
  status text not null default 'pendente'
    check (status in ('pendente', 'pago', 'cancelado')),
  origin text not null default 'manual'
    check (origin in ('manual', 'sale', 'purchase')),
  sale_id text references public.sales (id) on delete set null,
  purchase_order_id text references public.purchase_orders (id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (origin = 'sale' and sale_id is not null) or
    (origin = 'purchase' and purchase_order_id is not null) or
    (origin = 'manual' and sale_id is null and purchase_order_id is null)
  ),
  check (status <> 'pago' or paid_at is not null)
);
create index if not exists finance_workspace_due_idx
  on public.finance_entries (workspace_id, due_date);
create index if not exists finance_sale_idx
  on public.finance_entries (sale_id);
create index if not exists finance_purchase_idx
  on public.finance_entries (purchase_order_id);

-- ---------------------------------------------------------------------------
-- Campanhas e contadores de documentos
-- ---------------------------------------------------------------------------

create table if not exists public.campaigns (
  id text primary key default gen_random_uuid()::text,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  message text not null,
  audience text not null check (audience in ('all', 'birthday', 'inactive', 'tag')),
  tag text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (audience <> 'tag' or length(tag) > 0)
);

-- Registros excluídos no app: permitem que o outro aparelho remova o mesmo item.
create table if not exists public.tombstones (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  table_name text not null,
  record_key text not null,
  deleted_at timestamptz not null default now(),
  primary key (workspace_id, table_name, record_key)
);
create index if not exists tombstones_workspace_deleted_idx
  on public.tombstones (workspace_id, deleted_at);

create table if not exists public.document_counters (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('sale', 'purchase')),
  value integer not null default 0 check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, kind)
);

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'workspaces', 'brands', 'categories', 'tags', 'clients',
    'products', 'sales', 'purchase_orders', 'stock_movements',
    'finance_entries', 'campaigns', 'purchase_draft_items', 'document_counters',
    'sale_items', 'purchase_order_items', 'product_tags'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function public.touch_updated_at()', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed de referências ao criar um workspace
-- ---------------------------------------------------------------------------

create or replace function public.seed_workspace_reference(target uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.brands (workspace_id, nome)
  values (target, 'Natura')
  on conflict do nothing;

  insert into public.categories (workspace_id, nome)
  select target, nome
  from (values
    ('Perfumaria'), ('Corpo e Banho'), ('Cabelos'), ('Maquiagem'),
    ('Rosto'), ('Infantil'), ('Casa'), ('Presentes'), ('Acessórios')
  ) as c(nome)
  on conflict do nothing;

  insert into public.tags (workspace_id, tipo, nome)
  select target, tipo, nome
  from (values
    ('tipo_produto', 'Body Splash'), ('tipo_produto', 'Deo Colônia'),
    ('tipo_produto', 'Deo Parfum'), ('tipo_produto', 'Desodorante Spray'),
    ('tipo_produto', 'Hidratante Corporal'), ('tipo_produto', 'Hidratante para Mãos'),
    ('tipo_produto', 'Sabonete em Barra'), ('tipo_produto', 'Sabonete Líquido'),
    ('tipo_produto', 'Óleo Corporal'), ('tipo_produto', 'Kits e Combos'),
    ('tipo_produto', 'Protetor Solar'), ('tipo_produto', 'Shampoo'),
    ('tipo_produto', 'Condicionador'), ('tipo_produto', 'Máscara Capilar'),
    ('tipo_produto', 'Maquiagem'), ('tipo_produto', 'Acessório'),
    ('tipo_produto', 'Presente'),
    ('familia_olfativa', 'Floral'), ('familia_olfativa', 'Frutal'),
    ('familia_olfativa', 'Amadeirado'), ('familia_olfativa', 'Aromático'),
    ('familia_olfativa', 'Cítrico'), ('familia_olfativa', 'Adocicado'),
    ('familia_olfativa', 'Chypre'), ('familia_olfativa', 'Musk'),
    ('familia_olfativa', 'Gourmand'),
    ('linha', 'Tododia'), ('linha', 'Ekos'), ('linha', 'Essencial'),
    ('linha', 'Kaiak'), ('linha', 'Lumina'), ('linha', 'Una'),
    ('linha', 'Humor'), ('linha', 'Natura Homem'), ('linha', 'Chronos'),
    ('linha', 'Faces'), ('linha', 'Ilía'), ('linha', 'Sève'),
    ('linha', 'Naturé'), ('linha', 'Biografia'), ('linha', 'Aura'),
    ('linha', 'Crer Para Ver'), ('linha', 'Mamãe e Bebê')
  ) as t(tipo, nome)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding: cria perfil + workspace + referências no primeiro cadastro
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_workspace uuid;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Minha conta'
  );

  insert into public.profiles (id, nome)
  values (new.id, v_name)
  on conflict (id) do nothing;

  insert into public.workspaces (owner_id, name, store_name, consultant)
  values (new.id, 'UniHub', 'UniHub', v_name)
  returning id into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace, new.id, 'owner')
  on conflict do nothing;

  perform public.seed_workspace_reference(v_workspace);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Numeração atômica de pedidos e compras
-- ---------------------------------------------------------------------------

create or replace function public.next_document_number(p_workspace uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value integer;
  v_prefix text;
begin
  if not public.can_edit_workspace(p_workspace) then
    raise exception 'Acesso negado ao workspace.';
  end if;
  if p_kind not in ('sale', 'purchase') then
    raise exception 'Tipo de documento inválido: %', p_kind;
  end if;

  insert into public.document_counters (workspace_id, kind, value)
  values (p_workspace, p_kind, 1)
  on conflict (workspace_id, kind)
  do update set value = public.document_counters.value + 1,
                updated_at = now()
  returning value into v_value;

  v_prefix := case when p_kind = 'sale' then 'PED' else 'CMP' end;
  return v_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(v_value::text, 4, '0');
end;
$$;

grant execute on function public.next_document_number(uuid, text) to authenticated;

-- As funções security definer abaixo são internas (trigger/seed): ninguém precisa
-- chamá-las pela API. Revogar a permissão padrão de PUBLIC evita uso indevido.
revoke execute on function public.seed_workspace_reference(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.clients enable row level security;
alter table public.products enable row level security;
alter table public.product_tags enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_draft_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.finance_entries enable row level security;
alter table public.campaigns enable row level security;
alter table public.document_counters enable row level security;
alter table public.tombstones enable row level security;

-- Perfis: cada usuário vê e edita o próprio.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Workspaces.
drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists workspaces_insert_own on public.workspaces;
create policy workspaces_insert_own on public.workspaces
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner on public.workspaces
  for update to authenticated
  using (public.is_workspace_owner(id))
  with check (public.is_workspace_owner(id));

drop policy if exists workspaces_delete_owner on public.workspaces;
create policy workspaces_delete_owner on public.workspaces
  for delete to authenticated
  using (public.is_workspace_owner(id));

-- Membros: membros leem; dono gerencia.
drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert_owner on public.workspace_members;
create policy workspace_members_insert_owner on public.workspace_members
  for insert to authenticated
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists workspace_members_update_owner on public.workspace_members;
create policy workspace_members_update_owner on public.workspace_members
  for update to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists workspace_members_delete_owner on public.workspace_members;
create policy workspace_members_delete_owner on public.workspace_members
  for delete to authenticated
  using (public.is_workspace_owner(workspace_id));

-- Tabelas de dados: leitura para membros; escrita para owner/editor.
do $$
declare
  t text;
begin
  foreach t in array array[
    'brands', 'categories', 'tags', 'clients', 'products', 'product_tags',
    'sales', 'sale_items', 'purchase_orders', 'purchase_order_items',
    'purchase_draft_items', 'stock_movements', 'finance_entries',
    'campaigns', 'document_counters', 'tombstones'
  ]
  loop
    execute format('drop policy if exists %I_select_member on public.%I', t, t);
    execute format(
      'create policy %I_select_member on public.%I
       for select to authenticated
       using (public.is_workspace_member(workspace_id))', t, t
    );

    execute format('drop policy if exists %I_insert_editor on public.%I', t, t);
    execute format(
      'create policy %I_insert_editor on public.%I
       for insert to authenticated
       with check (public.can_edit_workspace(workspace_id))', t, t
    );

    execute format('drop policy if exists %I_update_editor on public.%I', t, t);
    execute format(
      'create policy %I_update_editor on public.%I
       for update to authenticated
       using (public.can_edit_workspace(workspace_id))
       with check (public.can_edit_workspace(workspace_id))', t, t
    );

    execute format('drop policy if exists %I_delete_editor on public.%I', t, t);
    execute format(
      'create policy %I_delete_editor on public.%I
       for delete to authenticated
       using (public.can_edit_workspace(workspace_id))', t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants explícitos (RLS continua controlando as linhas)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Views de consulta (security_invoker respeita o RLS das tabelas)
-- ---------------------------------------------------------------------------

create or replace view public.v_product_stock
with (security_invoker = true)
as
select
  p.workspace_id,
  p.id as product_id,
  p.codigo,
  p.nome,
  p.min_stock,
  p.cost,
  p.price,
  p.active,
  coalesce(s.saldo, 0)::integer as saldo
from public.products p
left join (
  select
    product_id,
    sum(
      case type
        when 'entrada' then quantity
        when 'devolucao' then quantity
        when 'saida' then -quantity
        when 'ajuste' then quantity
        else 0
      end
    )::integer as saldo
  from public.stock_movements
  group by product_id
) s on s.product_id = p.id;

create or replace view public.v_low_stock
with (security_invoker = true)
as
select *
from public.v_product_stock
where active = true
  and min_stock > 0
  and saldo < min_stock;

create or replace view public.v_client_stats
with (security_invoker = true)
as
select
  c.workspace_id,
  c.id as client_id,
  c.nome,
  count(s.id) filter (where s.status in ('confirmado', 'separado', 'enviado', 'entregue'))::integer as orders_count,
  coalesce(sum(s.total) filter (where s.status in ('confirmado', 'separado', 'enviado', 'entregue')), 0)::numeric(12, 2) as total_spent,
  max(coalesce(s.confirmed_at, s.created_at))
    filter (where s.status in ('confirmado', 'separado', 'enviado', 'entregue')) as last_purchase
from public.clients c
left join public.sales s
  on s.client_id = c.id
 and s.workspace_id = c.workspace_id
group by c.workspace_id, c.id, c.nome;

grant select on public.v_product_stock to authenticated;
grant select on public.v_low_stock to authenticated;
grant select on public.v_client_stats to authenticated;

-- ---------------------------------------------------------------------------
-- Observações para a próxima etapa
-- ---------------------------------------------------------------------------
-- 1. Confirme venda/cancelamento e fechamento de compra em RPCs transacionais
--    (as regras de negócio hoje estão nos módulos locais). Não faça várias
--    chamadas soltas do front para simular transação.
-- 2. O adaptador remoto deve carregar o workspace inteiro ou paginar o catálogo
--    e tratar conflitos por updated_at.
-- 3. Para importar o CSV em produção, faça o parse no front e envie lotes com
--    upsert em products/product_tags; nunca invente custo ou quantidade.
-- ============================================================================
