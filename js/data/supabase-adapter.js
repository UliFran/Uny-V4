/* ==========================================================================
   UniHub V4 — esqueleto do adaptador Supabase
   --------------------------------------------------------------------------
   IMPORTANTE: este arquivo NÃO é carregado pelo index.html e o app continua
   em modo local. Ele existe para a próxima etapa, quando o Supabase estiver
   configurado e as operações críticas virarem RPCs transacionais.

   O adaptador local (js/db.js) expõe operações síncronas. O Supabase é
   assíncrono por natureza; por isso a migração exige ajustar a camada de
   aplicação ou usar uma fila de sincronização. Não simule transações críticas
   com vários inserts soltos no front.

   Uso previsto:

     import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
     const client = createClient(HUB_CONFIG.supabaseUrl, HUB_CONFIG.supabaseAnonKey);
     const repo = Hub.createSupabaseAdapter({
       client,
       workspaceId: 'uuid-do-workspace'
     });
     const state = await repo.loadState();

   Depois: implementar as RPCs de confirmar/cancelar venda e fechar/reabrir
   compra em supabase/schema.sql (ou Edge Functions) e plugar os módulos.
   ========================================================================== */
(function (Hub) {
  'use strict';

  const PAGE_SIZE = 1000;
  // Paginação por range exige ordenação estável.
  const ORDER_COLUMN = { product_tags: 'product_id', purchase_draft_items: 'product_id', document_counters: 'kind' };

  function rowToProduct(row) {
    return {
      id: row.id,
      codigo: row.codigo,
      nome: row.nome,
      nomeTecnico: row.nome_tecnico || '',
      brandId: row.brand_id || null,
      categoryId: row.category_id || null,
      cost: Number(row.cost) || 0,
      price: Number(row.price) || 0,
      minStock: Number(row.min_stock) || 0,
      active: row.active !== false,
      description: row.description || '',
      imageUrl: row.image_url || '',
      productUrl: row.product_url || '',
      attributes: row.attributes || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function rowToSale(row, items) {
    return {
      id: row.id,
      number: row.number,
      clientId: row.client_id || null,
      clientName: row.client_name || 'Consumidor final',
      items: items,
      subtotal: Number(row.subtotal) || 0,
      discount: Number(row.discount) || 0,
      total: Number(row.total) || 0,
      paymentMethod: row.payment_method,
      dueDate: row.due_date || '',
      status: row.status,
      notes: row.notes || '',
      statusHistory: row.status_history || [],
      confirmedAt: row.confirmed_at || '',
      deliveredAt: row.delivered_at || '',
      canceledAt: row.canceled_at || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  Hub.createSupabaseAdapter = function (options) {
    const opts = options || {};
    const client = opts.client;
    const workspaceId = opts.workspaceId;
    if (!client || !workspaceId) {
      throw new Error('Informe client e workspaceId para criar o adaptador Supabase.');
    }

    let cache = null;

    async function fetchAll(table) {
      const rows = [];
      let from = 0;
      // Limite padrão do PostgREST: 1000 linhas por requisição.
      for (;;) {
        const to = from + PAGE_SIZE - 1;
        const result = await client
          .from(table)
          .select('*')
          .eq('workspace_id', workspaceId)
          .order(ORDER_COLUMN[table] || 'id', { ascending: true })
          .range(from, to);
        if (result.error) throw new Error(table + ': ' + result.error.message);
        const page = result.data || [];
        rows.push.apply(rows, page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return rows;
    }

    async function loadState() {
      const workspaceResult = await client
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .single();
      if (workspaceResult.error) throw new Error(workspaceResult.error.message);
      const workspace = workspaceResult.data;

      const [
        brands, categories, tags, productTags, products, clients,
        sales, saleItems, purchaseOrders, purchaseItems, purchaseDraft,
        movements, finance, campaigns, counters
      ] = await Promise.all([
        fetchAll('brands'),
        fetchAll('categories'),
        fetchAll('tags'),
        fetchAll('product_tags'),
        fetchAll('products'),
        fetchAll('clients'),
        fetchAll('sales'),
        fetchAll('sale_items'),
        fetchAll('purchase_orders'),
        fetchAll('purchase_order_items'),
        fetchAll('purchase_draft_items'),
        fetchAll('stock_movements'),
        fetchAll('finance_entries'),
        fetchAll('campaigns'),
        fetchAll('document_counters')
      ]);

      const itemsBySale = {};
      saleItems
        .sort(function (a, b) { return (a.position || 0) - (b.position || 0); })
        .forEach(function (item) {
          if (!itemsBySale[item.sale_id]) itemsBySale[item.sale_id] = [];
          itemsBySale[item.sale_id].push({
            productId: item.product_id,
            codigo: item.codigo,
            nome: item.nome,
            qty: Number(item.qty) || 0,
            unitPrice: Number(item.unit_price) || 0,
            discount: Number(item.discount) || 0,
            total: Number(item.total) || 0
          });
        });

      const itemsByOrder = {};
      purchaseItems
        .sort(function (a, b) { return (a.position || 0) - (b.position || 0); })
        .forEach(function (item) {
          if (!itemsByOrder[item.purchase_order_id]) itemsByOrder[item.purchase_order_id] = [];
          itemsByOrder[item.purchase_order_id].push({
            productId: item.product_id,
            codigo: item.codigo,
            nome: item.nome,
            qty: Number(item.qty) || 0,
            unitCost: Number(item.unit_cost) || 0
          });
        });

      cache = {
        meta: {
          version: 1,
          createdAt: workspace.created_at,
          updatedAt: workspace.updated_at,
          demo: false,
          source: 'supabase'
        },
        settings: {
          storeName: workspace.store_name || 'UniHub',
          consultant: workspace.consultant || ''
        },
        brands: brands.map(function (row) {
          return { id: row.id, nome: row.nome, createdAt: row.created_at, updatedAt: row.updated_at };
        }),
        categories: categories.map(function (row) {
          return { id: row.id, nome: row.nome, createdAt: row.created_at, updatedAt: row.updated_at };
        }),
        tags: tags.map(function (row) {
          return { id: row.id, tipo: row.tipo, nome: row.nome, createdAt: row.created_at, updatedAt: row.updated_at };
        }),
        productTags: productTags.map(function (row) {
          return { productId: row.product_id, tagId: row.tag_id };
        }),
        products: products.map(rowToProduct),
        clients: clients.map(function (row) {
          return {
            id: row.id,
            nome: row.nome,
            phone: row.phone || '',
            email: row.email || '',
            birthday: row.birthday || '',
            city: row.city || '',
            tags: row.tags || [],
            notes: row.notes || '',
            active: row.active !== false,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        }),
        sales: sales.map(function (row) { return rowToSale(row, itemsBySale[row.id] || []); }),
        purchaseOrders: purchaseOrders.map(function (row) {
          return {
            id: row.id,
            number: row.number,
            status: row.status,
            items: itemsByOrder[row.id] || [],
            total: Number(row.total) || 0,
            notes: row.notes || '',
            closedAt: row.closed_at || '',
            receivedAt: row.received_at || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        }),
        purchaseDraft: purchaseDraft.map(function (row) {
          return { productId: row.product_id, qty: Number(row.qty) || 0 };
        }),
        movements: movements.map(function (row) {
          return {
            id: row.id,
            productId: row.product_id,
            type: row.type,
            quantity: Number(row.quantity) || 0,
            unitCost: Number(row.unit_cost) || 0,
            unitPrice: Number(row.unit_price) || 0,
            cycle: row.cycle || '',
            expiry: row.expiry || '',
            supplier: row.supplier || '',
            note: row.note || '',
            saleId: row.sale_id || '',
            orderId: row.purchase_order_id || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        }),
        finance: finance.map(function (row) {
          return {
            id: row.id,
            type: row.type,
            description: row.description,
            amount: Number(row.amount) || 0,
            category: row.category || 'Outros',
            dueDate: row.due_date || '',
            paidAt: row.paid_at || '',
            status: row.status,
            origin: row.origin,
            saleId: row.sale_id || '',
            purchaseOrderId: row.purchase_order_id || '',
            notes: row.notes || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        }),
        campaigns: campaigns.map(function (row) {
          return {
            id: row.id,
            name: row.name,
            message: row.message,
            audience: row.audience,
            tag: row.tag || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        }),
        counters: counters.reduce(function (acc, row) {
          acc[row.kind] = Number(row.value) || 0;
          return acc;
        }, { sale: 0, purchase: 0 })
      };

      return cache;
    }

    async function nextNumber(kind) {
      const result = await client.rpc('next_document_number', {
        p_workspace: workspaceId,
        p_kind: kind
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    }

    async function invoke(name, args) {
      const result = await client.rpc(name, args || {});
      if (result.error) throw new Error(result.error.message);
      return result.data;
    }

    return {
      raw: client,
      workspaceId: workspaceId,
      loadState: loadState,
      get: function () { return cache; },
      nextNumber: nextNumber,
      invoke: invoke,
      // As operações de escrita exigem RPCs transacionais. Não implemente
      // confirmar/cancelar venda com inserts soltos no front.
      tx: function () {
        throw new Error(
          'O adaptador Supabase está em modo somente leitura. ' +
          'Implemente as RPCs transacionais antes de ativar dataMode="supabase".'
        );
      }
    };
  };
})(window.Hub = window.Hub || {});
