import { montarLayout } from '../components/layout.js';
import { alternarTema } from '../utils/theme.js';
import { getFiltrosSalvos, removerFiltroSalvo } from '../services/crmService.js';
import { getConfigBuscaSocial, salvarConfigBuscaSocial } from '../services/socialSearchService.js';

montarLayout({ paginaAtiva: 'config', titulo: 'Configurações', prefixo: '../' });
const content = document.getElementById('content');

function skeleton() {
  content.innerHTML = `
    <div class="card">
      <h2>Aparência</h2>
      <p class="sub">Alterna entre tema claro e escuro (também disponível no topo de qualquer página).</p>
      <button class="btn" id="btn-tema-config">Alternar tema</button>
    </div>

    <div class="card">
      <h2>Busca automática de redes sociais (opcional)</h2>
      <p class="sub">
        Usa o <strong>Gemini API</strong> (com Grounding com Google Search) para sugerir Instagram, Facebook,
        LinkedIn, YouTube e Google Maps de cada escola na aba Marketing Digital. Os resultados são sugestões —
        confira antes de salvar, pois nomes parecidos podem confundir.
      </p>
      <p class="sub">
        <strong>Custo:</strong> se sua empresa já tem uma conta paga do Gemini, os modelos da família Gemini 3.x
        dão 5.000 buscas com grounding grátis por mês — para o uso deste app (enriquecimento gradual, não em
        massa), isso costuma ficar todo dentro da cota gratuita. Acima disso, cerca de US$ 14 a cada 1.000 buscas.
      </p>
      <p class="sub">Como conseguir a chave: acessa <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>
        (com a conta Google da sua empresa que já tem o Gemini pago), cria uma chave de API e cola abaixo.</p>
      <div class="field-row">
        <div><label>Chave de API do Gemini</label><input type="password" id="f-chave-busca-social" placeholder="AIza..."></div>
      </div>
      <button class="btn btn-primary" id="btn-salvar-busca-social">Salvar</button>
      <span class="loading-bar" id="msg-busca-social-config"></span>
    </div>

    <div class="card">
      <h2>Filtros salvos</h2>
      <p class="sub">Filtros que você salvou na Consulta de escolas. Clique para reaplicar.</p>
      <div id="lista-filtros-salvos"></div>
    </div>

  `;
}

async function renderTags() {
  const tags = await listarTags();
  const container = document.getElementById('lista-tags');
  if (!tags.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12.5px;">Nenhuma tag cadastrada.</p>';
    return;
  }
  container.innerHTML = tags.map((t) => `
    <div class="field-row" style="grid-template-columns: auto 1fr 100px 120px auto; align-items:center;" data-id="${t.id}">
      <span class="tag-chip" style="background:${t.cor};">${t.nome}</span>
      <input type="text" class="tag-edit-nome" value="${t.nome}">
      <input type="color" class="tag-edit-cor" value="${t.cor}">
      <select class="tag-edit-tipo">
        <option value="status" ${t.tipo === 'status' ? 'selected' : ''}>Status</option>
        <option value="vendedor" ${t.tipo === 'vendedor' ? 'selected' : ''}>Vendedor</option>
        <option value="outro" ${t.tipo === 'outro' ? 'selected' : ''}>Outro</option>
      </select>
      <div>
        <button class="btn btn-salvar-tag" data-id="${t.id}">Salvar</button>
        <button class="btn-fechar btn-excluir-tag" data-id="${t.id}" title="Excluir">&times;</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.btn-salvar-tag').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const linha = btn.closest('.field-row');
      const id = Number(linha.dataset.id);
      const tag = tags.find((t) => t.id === id);
      tag.nome = linha.querySelector('.tag-edit-nome').value.trim();
      tag.cor = linha.querySelector('.tag-edit-cor').value;
      tag.tipo = linha.querySelector('.tag-edit-tipo').value;
      await atualizarTag(tag);
      renderTags();
    });
  });
  container.querySelectorAll('.btn-excluir-tag').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta tag? Ela será removida do catálogo (escolas que já tinham essa tag mantêm o registro histórico).')) return;
      await excluirTag(Number(btn.dataset.id));
      renderTags();
    });
  });
}

async function renderFiltrosSalvos() {
  const lista = await getFiltrosSalvos();
  const container = document.getElementById('lista-filtros-salvos');
  if (!lista.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:12.5px;">Nenhum filtro salvo ainda.</p>';
    return;
  }
  container.innerHTML = lista.map((f) => `
    <div class="interacao-item" style="display:flex;justify-content:space-between;align-items:center;">
      <a href="../pages/busca.html?filtro=${encodeURIComponent(f.nome)}" style="color:var(--text-accent, inherit);text-decoration:underline;">${f.nome}</a>
      <button class="btn-fechar btn-remover-filtro" data-nome="${f.nome}" title="Remover">&times;</button>
    </div>`).join('');
  container.querySelectorAll('.btn-remover-filtro').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await removerFiltroSalvo(btn.dataset.nome);
      renderFiltrosSalvos();
    });
  });
}

async function init() {
  skeleton();
  document.getElementById('btn-tema-config').addEventListener('click', alternarTema);

  const configBuscaSocial = await getConfigBuscaSocial();
  document.getElementById('f-chave-busca-social').value = configBuscaSocial.chaveGemini || '';
  document.getElementById('btn-salvar-busca-social').addEventListener('click', async () => {
    await salvarConfigBuscaSocial({
      chaveGemini: document.getElementById('f-chave-busca-social').value.trim(),
    });
    document.getElementById('msg-busca-social-config').textContent = 'Salvo.';
    setTimeout(() => { const m = document.getElementById('msg-busca-social-config'); if (m) m.textContent = ''; }, 2000);
  });

  await renderFiltrosSalvos();
}

init();
