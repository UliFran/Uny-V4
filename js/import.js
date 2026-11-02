/* ==========================================================================
   UniHub V4 — importador opcional do catálogo Natura (CSV)
   --------------------------------------------------------------------------
   Não importa estoque nem custo: o CSV não traz esses dados.
   Faz prévia, deduplicação por código e relatório de SKUs ambíguos antes de
   gravar qualquer coisa.
   ========================================================================== */
(function (Hub) {
  'use strict';

  const U = Hub.utils;
  const DB = Hub.db;
  const UI = Hub.ui;
  const M = {};

  const CATEGORY_MAP = {
    maquiagem: 'Maquiagem',
    perfumaria: 'Perfumaria',
    corpo: 'Corpo e Banho',
    'corpo e banho': 'Corpo e Banho',
    cabelos: 'Cabelos',
    rosto: 'Rosto',
    infantil: 'Infantil',
    casa: 'Casa',
    presentes: 'Presentes',
    presente: 'Presentes',
    acessorios: 'Acessórios',
    acessorio: 'Acessórios',
    kit: 'Presentes',
    kits: 'Presentes',
    'todos-produtos': 'Outros',
    'todos os produtos': 'Outros'
  };

  function titleCase(value) {
    return U.normalizeText(value).toLowerCase().replace(/(^|\s|[-/])([a-zà-ú])/g, function (m, sep, letter) {
      return sep + letter.toUpperCase();
    });
  }

  /** Aceita apenas links http(s); descarta qualquer outro esquema (javascript:, data:...). */
  function safeUrl(value) {
    const text = U.normalizeText(value);
    return /^https?:\/\//i.test(text) ? text : '';
  }

  function mapCategory(raw) {
    const key = U.normalizeText(raw).toLowerCase();
    return CATEGORY_MAP[key] || titleCase(raw) || 'Outros';
  }

  function rawType(row) {
    const tags = String(row.tags_filtros || '').split('|').map(U.normalizeText).filter(Boolean);
    return tags.length > 1 ? tags[1] : '';
  }

  function prepare(rows) {
    const codeSeen = {};
    const nameGroups = {};
    const valid = [];
    let blankCode = 0;
    let duplicateCode = 0;
    let noPrice = 0;
    let noName = 0;

    rows.forEach(function (row) {
      const code = U.normalizeCode(row.codigo);
      const name = U.normalizeText(row.nome);
      if (!code) { blankCode += 1; return; }
      if (!name) { noName += 1; return; }
      if (codeSeen[code]) { duplicateCode += 1; return; }
      codeSeen[code] = true;

      const price = U.parseMoney(row.preco_de) || U.parseMoney(row.preco_site);
      if (!price) noPrice += 1;

      const key = (name + ' ' + U.normalizeText(row.nome_tecnico)).toLowerCase();
      if (!nameGroups[key]) nameGroups[key] = 0;
      nameGroups[key] += 1;

      valid.push({
        code: code,
        name: name,
        technical: U.normalizeText(row.nome_tecnico),
        line: U.normalizeText(row.linha_marca),
        category: mapCategory(row.categoria),
        type: titleCase(rawType(row)),
        family: titleCase(row.familia_olfativa),
        price: U.round(price, 2),
        priceFrom: U.round(U.parseMoney(row.preco_de), 2),
        priceSite: U.round(U.parseMoney(row.preco_site), 2),
        description: U.normalizeText(row.descricao),
        image: U.normalizeText(row.imagem),
        url: U.normalizeText(row.url),
        attributes: {
          publico: U.normalizeText(row.publico),
          concentracao: U.normalizeText(row.tipo_concentracao),
          subfamilia: U.normalizeText(row.subfamilia),
          ocasiao: U.normalizeText(row.ocasiao),
          notas_topo: U.normalizeText(row.notas_topo),
          notas_corpo: U.normalizeText(row.notas_corpo),
          notas_fundo: U.normalizeText(row.notas_fundo),
          tipo_pele: U.normalizeText(row.tipo_de_pele),
          textura: U.normalizeText(row.textura),
          zona_aplicacao: U.normalizeText(row.zona_aplicacao),
          disponibilidade: U.normalizeText(row.disponibilidade),
          avaliacao: U.normalizeText(row.avaliacao),
          qtd_avaliacoes: U.normalizeText(row.qtd_avaliacoes),
          tags_filtros: U.normalizeText(row.tags_filtros)
        },
        groupKey: key
      });
    });

    const ambiguousKeys = {};
    Object.keys(nameGroups).forEach(function (key) {
      if (nameGroups[key] > 1) ambiguousKeys[key] = nameGroups[key];
    });
    valid.forEach(function (row) { row.ambiguous = Boolean(ambiguousKeys[row.groupKey]); });

    return {
      valid: valid,
      blankCode: blankCode,
      noName: noName,
      duplicateCode: duplicateCode,
      noPrice: noPrice,
      ambiguousGroups: Object.keys(ambiguousKeys).length,
      ambiguousRows: valid.filter(function (r) { return r.ambiguous; }).length
    };
  }

  function option(label, checked) {
    const wrap = U.el('label');
    wrap.appendChild(U.el('input', { type: 'checkbox', checked: Boolean(checked) }));
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  function renderReport(container, prepared, optionsBox, importButton) {
    U.clear(container);
    const summary = U.el('div', { class: 'import-summary' });
    [
      ['Linhas válidas', String(prepared.valid.length)],
      ['Códigos repetidos', String(prepared.duplicateCode)],
      ['Sem código', String(prepared.blankCode)],
      ['Sem preço', String(prepared.noPrice)],
      ['Nomes repetidos', String(prepared.ambiguousRows)]
    ].forEach(function (item) {
      const box = U.el('div', { class: 'import-stat' });
      box.appendChild(U.el('strong', { text: item[1] }));
      box.appendChild(U.el('span', { text: item[0] }));
      summary.appendChild(box);
    });
    container.appendChild(summary);

    if (prepared.ambiguousGroups) {
      container.appendChild(U.el('div', {
        class: 'import-warning',
        text: prepared.ambiguousGroups + ' grupo(s) têm nomes iguais e podem representar variações (cor, tom ou tamanho). Os códigos continuam únicos; revise-os depois da importação.'
      }));
    }

    U.clear(optionsBox);
    optionsBox.appendChild(option('Criar marcas, categorias, linhas, tipos e famílias que não existirem', true));
    optionsBox.appendChild(option('Atualizar produtos que já tenham o mesmo código', true));
    optionsBox.appendChild(option('Sobrescrever o preço de revista dos produtos existentes (senão preserva o seu)', false));
    optionsBox.appendChild(option('Importar descrições, imagens e links', true));
    optionsBox.appendChild(option('Ignorar SKUs com nome repetido', false));
    optionsBox.querySelectorAll('input').forEach(function (input, index) {
      input.dataset.option = ['references', 'update', 'updatePrice', 'details', 'skipAmbiguous'][index];
    });

    const wrap = U.el('div', { class: 'table-wrap import-table' });
    const table = U.el('table', { class: 'data-table' });
    table.appendChild(U.el('caption', { class: 'sr-only', text: 'Prévia dos produtos do CSV' }));
    const head = U.el('thead');
    const hr = U.el('tr');
    ['Código', 'Produto', 'Linha', 'Categoria', 'Revista', ''].forEach(function (label, idx) {
      hr.appendChild(U.el('th', { scope: 'col', class: idx === 4 ? 'num' : '', text: label }));
    });
    head.appendChild(hr);
    table.appendChild(head);
    const tb = U.el('tbody');
    prepared.valid.slice(0, 8).forEach(function (row) {
      const tr = U.el('tr');
      tr.appendChild(U.el('td', { class: 'nowrap', text: row.code }));
      const name = U.el('td');
      name.appendChild(U.el('span', { class: 'strong', text: row.name }));
      if (row.technical) name.appendChild(U.el('span', { class: 'sub', text: row.technical }));
      tr.appendChild(name);
      tr.appendChild(U.el('td', { text: row.line || '—' }));
      tr.appendChild(U.el('td', { text: row.category }));
      tr.appendChild(U.el('td', { class: 'num', text: U.fmtMoney(row.price) }));
      const flag = U.el('td');
      if (row.ambiguous) flag.appendChild(UI.badge('Nome repetido', 'amber'));
      tr.appendChild(flag);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    container.appendChild(wrap);
    importButton.disabled = prepared.valid.length === 0;
  }

  function importRows(prepared, options) {
    const brandId = (function () {
      const state = DB.get();
      const found = state.brands.find(function (b) { return U.normalizeText(b.nome).toLowerCase() === 'natura'; });
      return found ? found.id : null;
    })();

    const result = DB.tx(function (s) {
      const natId = DB.addBrand(s, 'Natura') || brandId;
      let created = 0;
      let updated = 0;
      let skipped = 0;

      const byCode = new Map();
      s.products.forEach(function (p) { byCode.set(p.codigo, p); });

      prepared.valid.forEach(function (row) {
        if (options.skipAmbiguous && row.ambiguous) { skipped += 1; return; }
        const existing = byCode.get(row.code);
        if (existing && !options.update) { skipped += 1; return; }

        let categoryId = null;
        if (options.references) {
          categoryId = DB.addCategory(s, row.category);
        } else {
          const cat = s.categories.find(function (c) { return c.nome === row.category; });
          categoryId = cat ? cat.id : null;
        }

        let product = existing;
        if (!product) {
          product = {
            id: U.uid('prod'),
            codigo: row.code,
            cost: 0,
            minStock: 0,
            active: true,
            createdAt: U.nowISO(),
            attributes: {},
            productUrl: '',
            imageUrl: '',
            description: ''
          };
          s.products.push(product);
          byCode.set(row.code, product);
          created += 1;
        } else {
          updated += 1;
        }

        product.nome = row.name;
        product.nomeTecnico = row.technical;
        product.brandId = natId;
        product.categoryId = categoryId;
        if (row.price > 0 && (!existing || options.updatePrice || !(product.price > 0))) product.price = row.price;
        if (options.details) {
          product.description = row.description;
          product.imageUrl = safeUrl(row.image);
          product.productUrl = safeUrl(row.url);
        }
        product.attributes = Object.assign({}, product.attributes || {}, row.attributes, {
          preco_de: row.priceFrom,
          preco_site: row.priceSite,
          linha_marca: row.line,
          categoria_origem: row.category,
          ambiguous: row.ambiguous,
          importedAt: U.nowISO(),
          importedFrom: 'natura-csv'
        });
        product.updatedAt = U.nowISO();

        if (options.references) {
          const tagIds = [];
          if (row.line) tagIds.push(DB.addTag(s, 'linha', row.line));
          if (row.type) tagIds.push(DB.addTag(s, 'tipo_produto', row.type));
          if (row.family) tagIds.push(DB.addTag(s, 'familia_olfativa', row.family));
          const importedTypes = ['linha', 'tipo_produto', 'familia_olfativa'];
          const keep = s.productTags.filter(function (pt) {
            if (pt.productId !== product.id) return true;
            const tag = s.tags.find(function (t) { return t.id === pt.tagId; });
            return !tag || importedTypes.indexOf(tag.tipo) === -1;
          });
          tagIds.filter(Boolean).forEach(function (id) {
            if (!keep.some(function (pt) { return pt.productId === product.id && pt.tagId === id; })) {
              keep.push({ productId: product.id, tagId: id });
            }
          });
          s.productTags = keep;
        }
      });

      return { created: created, updated: updated, skipped: skipped };
    });

    return result;
  }

  M.open = function () {
    const dialog = document.getElementById('import-dialog');
    if (!dialog) return;
    U.clear(dialog);

    const form = U.el('form', { class: 'dialog-form', method: 'dialog' });
    form.appendChild(UI.dialogHeader('Catálogo', 'Importar produtos do CSV', dialog));
    const body = U.el('div', { class: 'dialog-body' });
    body.appendChild(U.el('p', { class: 'dialog-lead', text: 'Use o arquivo natura_produtos_parcial.csv. A importação cria apenas o catálogo: preços de revista, descrições, imagens e classificação. Custo e estoque não existem no arquivo e não serão inventados.' }));

    const drop = U.el('div', { class: 'drop-zone' });
    drop.appendChild(U.icon('upload'));
    drop.appendChild(U.el('strong', { text: 'Selecione o CSV da Natura' }));
    drop.appendChild(U.el('span', { class: 'small muted', text: 'Delimitador ; ou , — o arquivo é processado neste navegador, sem envio para servidor.' }));
    const fileInput = U.el('input', { type: 'file', id: 'import-file', accept: '.csv,text/csv' });
    drop.appendChild(fileInput);
    body.appendChild(drop);

    const report = U.el('div', { id: 'import-report' });
    body.appendChild(report);
    const optionsBox = U.el('div', { class: 'import-options', id: 'import-options' });
    body.appendChild(optionsBox);

    form.appendChild(body);
    const cancel = U.el('button', { class: 'btn btn-secondary', type: 'submit', value: 'cancel' }, 'Fechar');
    const importButton = U.el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, U.icon('upload'), 'Importar catálogo');
    form.appendChild(UI.dialogFooter([cancel, importButton]));

    let prepared = null;

    fileInput.addEventListener('change', async function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        const text = await U.readFile(file);
        const csv = U.parseCSV(text);
        if (!csv.headers.length) throw new Error('Arquivo vazio ou formato não reconhecido.');
        if (csv.headers.indexOf('codigo') === -1 || csv.headers.indexOf('nome') === -1) {
          throw new Error('O CSV precisa ter as colunas "codigo" e "nome".');
        }
        prepared = prepare(csv.rows);
        renderReport(report, prepared, optionsBox, importButton);
        drop.querySelector('strong').textContent = file.name + ' · ' + csv.rows.length + ' linha(s)';
      } catch (err) {
        U.clear(report);
        report.appendChild(U.el('div', { class: 'import-warning', text: err.message }));
        importButton.disabled = true;
      }
    });

    importButton.addEventListener('click', function () {
      if (!prepared || !prepared.valid.length) return;
      const options = { references: true, update: true, details: true, skipAmbiguous: false };
      U.$$('#import-options input[data-option]').forEach(function (input) {
        options[input.dataset.option] = input.checked;
      });
      const button = importButton;
      U.setBusy(button, true, 'Importando…');
      try {
        const result = importRows(prepared, options);
        dialog.close();
        UI.toast(result.created + ' criado(s), ' + result.updated + ' atualizado(s), ' + result.skipped + ' ignorado(s).', 'success', 'Catálogo importado');
        if (Hub.modules.estoque) {
          Hub.modules.estoque.render();
        }
      } catch (err) {
        UI.toast(err.message, 'error');
        U.setBusy(button, false);
      }
    });

    dialog.appendChild(form);
    UI.openDialog(dialog);
  };

  Hub.importer = M;
})(window.Hub = window.Hub || {});
