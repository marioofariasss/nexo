import { montarLayout } from '../components/layout.js';
import { alternarTema } from '../utils/theme.js';
import { getFiltrosSalvos, removerFiltroSalvo, getChaveApiIA, salvarChaveApiIA, getMeuNome, salvarMeuNome } from '../services/crmService.js';
import { exportarBackupCompleto, importarBackupCompleto } from '../services/backupService.js';
import { listarTags, criarTag, atualizarTag, excluirTag } from '../services/tagService.js';
import { getConfigBuscaSocial, salvarConfigBuscaSocial } from '../services/socialSearchService.js';

montarLayout({ paginaAtiva: 'config', titulo: 'Configurações', prefixo: '../' });
const content = document.getElementById('content');

function skeleton() {
  content.innerHTML = `
    <div class="card">
      <h2>Meu nome</h2>
      <p class="sub">Usado para registrar quem fez cada alteração no histórico de marcadores e interações.</p>
      <div class="field-row">
        <div><label>Nome</label><input type="text" id="f-meu-nome" placeholder="Como você quer aparecer no histórico"></div>
      </div>
      <button class="btn btn-primary" id="btn-salvar-nome">Salvar</button>
      <span class="loading-bar" id="msg-nome"></span>
    </div>

    <div class="card">
      <h2>Aparência</h2>
      <p class="sub">Alterna entre tema claro e escuro (também disponível no topo de qualquer página).</p>
      <button class="btn" id="btn-tema-config">Alternar tema</button>
    </div>

    <div class="card">
      <h2>Marcadores</h2>
      <p class="sub">Catálogo de tags usadas para organizar a prospecção. Marque uma tag como "representa vendedor" para usá-la como responsável por uma escola.</p>
      <div id="lista-tags"></div>
      <h3 style="margin-top:16px;">Nova tag</h3>
      <div class="field-row">
        <div><label>Nome</label><input type="text" id="f-nova-tag-nome" placeholder="ex: João, Prioridade Alta..."></div>
        <div><label>Cor</label><input type="color" id="f-nova-tag-cor" value="#378ADD"></div>
      </div>
      <div class="field-row">
        <div>
          <label>Tipo</label>
          <select id="f-nova-tag-tipo">
            <option value="status">Status</option>
            <option value="vendedor">Vendedor (responsável)</option>
            <option value="outro">Outro</option>
          </select>
        </div>
        <div><label>Ordem de exibição</label><input type="number" id="f-nova-tag-ordem" value="50"></div>
      </div>
      <button class="btn btn-primary" id="btn-add-tag">Criar tag</button>
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
      <h2>Recursos de IA (opcional)</h2>
      <p class="sub">
        Cole aqui sua chave de API da <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>
        para habilitar resumo automático, sugestão de abordagem e outros recursos de IA na ficha da escola.
        <strong>Atenção:</strong> como este app não tem backend, a chave fica salva neste navegador e é visível a quem tiver
        acesso a ele — use uma chave com limite de gasto configurado, dedicada a este uso.
      </p>
      <div class="field-row">
        <div><label>Chave de API</label><input type="password" id="f-chave-ia" placeholder="sk-ant-..."></div>
      </div>
      <button class="btn btn-primary" id="btn-salvar-chave">Salvar chave</button>
      <button class="btn" id="btn-remover-chave">Remover chave</button>
      <span class="loading-bar" id="msg-chave"></span>
    </div>

    <div class="card">
      <h2>Backup e restauração</h2>
      <p class="sub">
        Exporta os marcadores, o catálogo de tags, o histórico e as interações para um arquivo JSON — útil para não perder
        nada ao trocar de computador, ou para repassar sua carteira para outro vendedor/gestor manualmente (lembrete: este
        app não sincroniza automaticamente entre navegadores, e documentos anexados não entram no backup).
      </p>
      <button class="btn btn-primary" id="btn-exportar-backup">Exportar backup completo</button>
      <div style="margin-top:10px;">
        <label style="font-size:11px;color:var(--text-secondary);display:block;margin-bottom:4px;">Importar backup (mescla com os dados atuais)</label>
        <input type="file" id="f-importar-backup" accept="application/json">
      </div>
      <span class="loading-bar" id="msg-backup"></span>
    </div>

    <div class="card">
      <h2>Filtros salvos</h2>
      <p class="sub">Filtros que você salvou na Consulta de escolas. Clique para reaplicar.</p>
      <div id="lista-filtros-salvos"></div>
    </div>

    <div class="card">
      <h2>Permissões</h2>
      <p class="sub">
        Este app roda 100% no seu navegador, sem login nem backend — por isso não há perfis de Administrador/Gestor/Vendedor
        com permissões diferentes: qualquer pessoa que abrir este navegador tem acesso completo aos dados salvos nele. Se
        isso se tornar uma limitação real para o time, esse é o ponto onde vale migrar a camada comercial para um backend
        como o Supabase (ver ARQUITETURA.md).
      </p>
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

  document.getElementById('f-meu-nome').value = await getMeuNome();
  document.getElementById('btn-salvar-nome').addEventListener('click', async () => {
    await salvarMeuNome(document.getElementById('f-meu-nome').value.trim());
    document.getElementById('msg-nome').textContent = 'Salvo.';
    setTimeout(() => { const m = document.getElementById('msg-nome'); if (m) m.textContent = ''; }, 1500);
  });

  await renderTags();
  document.getElementById('btn-add-tag').addEventListener('click', async () => {
    const nome = document.getElementById('f-nova-tag-nome').value.trim();
    if (!nome) return;
    await criarTag({
      nome,
      cor: document.getElementById('f-nova-tag-cor').value,
      tipo: document.getElementById('f-nova-tag-tipo').value,
      ordem: Number(document.getElementById('f-nova-tag-ordem').value) || 50,
    });
    document.getElementById('f-nova-tag-nome').value = '';
    renderTags();
  });

  const chaveAtual = await getChaveApiIA();
  if (chaveAtual) document.getElementById('f-chave-ia').value = chaveAtual;

  document.getElementById('btn-salvar-chave').addEventListener('click', async () => {
    await salvarChaveApiIA(document.getElementById('f-chave-ia').value.trim());
    document.getElementById('msg-chave').textContent = 'Chave salva.';
    setTimeout(() => { const m = document.getElementById('msg-chave'); if (m) m.textContent = ''; }, 2000);
  });
  document.getElementById('btn-remover-chave').addEventListener('click', async () => {
    await salvarChaveApiIA('');
    document.getElementById('f-chave-ia').value = '';
    document.getElementById('msg-chave').textContent = 'Chave removida.';
  });

  document.getElementById('btn-exportar-backup').addEventListener('click', exportarBackupCompleto);
  document.getElementById('f-importar-backup').addEventListener('change', async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const msg = document.getElementById('msg-backup');
    try {
      const resultado = await importarBackupCompleto(arquivo);
      msg.textContent = `Importado: ${resultado.crm} escolas com marcadores, ${resultado.tags} tags, ${resultado.interacoes} interações.`;
    } catch (err) {
      msg.textContent = `Erro: ${err.message}`;
    }
  });

  await renderFiltrosSalvos();
}

init();
