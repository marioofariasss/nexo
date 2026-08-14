import { alternarTema } from '../utils/theme.js';
import { buscarEscolas } from '../services/escolaService.js';
import { abrirPainelEscola } from './painelEscola.js';

const ITENS_NAV = [
  { href: 'index.html', icone: '&#9737;', label: 'Dashboard', chave: 'dashboard' },
  { href: 'pages/inteligencia.html', icone: '&#128200;', label: 'Inteligência', chave: 'inteligencia' },
  { href: 'pages/busca.html', icone: '&#128269;', label: 'Base de Escolas', chave: 'busca' },
  { href: 'pages/mercado.html', icone: '&#128506;', label: 'Mapear Mercado', chave: 'mercado' },
  { href: 'pages/enriquecimento.html', icone: '&#128295;', label: 'Enriquecimento', chave: 'enriquecimento' },
  { href: 'pages/config.html', icone: '&#9881;', label: 'Configurações', chave: 'config' },
];

/**
 * Monta o layout (sidebar + topbar com busca global + área de conteúdo)
 * dentro de #app-shell.
 * @param {Object} opts
 * @param {string} opts.paginaAtiva - chave da página atual (para destacar no menu)
 * @param {string} opts.titulo - título mostrado na topbar
 * @param {string} opts.prefixo - '' na raiz, '../' dentro de /pages
 */
export function montarLayout({ paginaAtiva, titulo, prefixo = '' }) {
  const shell = document.getElementById('app-shell');
  if (!shell) return;

  const navHtml = ITENS_NAV.map((item) => {
    const href = item.href.startsWith('pages/') && prefixo ? item.href.replace('pages/', '') : prefixo + item.href;
    const ativo = item.chave === paginaAtiva ? 'active' : '';
    return `<a class="nav-item ${ativo}" href="${href}">
      <span class="icon">${item.icone}</span><span>${item.label}</span>
    </a>`;
  }).join('');

  shell.innerHTML = `
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
    <aside class="sidebar" id="sidebar">
      <div class="brand">Nexo<span>Inteligência do mercado educacional</span></div>
      <nav>${navHtml}</nav>
      <div class="nav-footer">Dados: Censo Escolar INEP<br>Uso local neste navegador</div>
    </aside>
    <div class="main-area">
      <div class="topbar">
        <button class="menu-toggle" id="btn-menu" aria-label="Abrir menu">&#9776;</button>
        <h1>${titulo}</h1>
        <div class="global-search">
          <span class="icone-lupa">&#128269;</span>
          <input type="text" id="busca-global-input" placeholder="Buscar escola, CNPJ ou cidade...">
          <div class="global-search-resultados hidden" id="busca-global-resultados"></div>
        </div>
        <div class="actions">
          <button class="theme-toggle" id="btn-tema" title="Alternar tema">&#9788;/&#9790;</button>
        </div>
      </div>
      <div class="content" id="content"></div>
    </div>
  `;

  document.getElementById('btn-tema').addEventListener('click', alternarTema);
  ligarMenuMobile();
  ligarBuscaGlobal(prefixo);
}

function ligarMenuMobile() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const btnMenu = document.getElementById('btn-menu');
  const abrir = () => { sidebar.classList.add('aberta'); backdrop.classList.add('visivel'); };
  const fechar = () => { sidebar.classList.remove('aberta'); backdrop.classList.remove('visivel'); };
  btnMenu.addEventListener('click', abrir);
  backdrop.addEventListener('click', fechar);
  sidebar.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', fechar));
}

function ligarBuscaGlobal(prefixo) {
  const input = document.getElementById('busca-global-input');
  const resultadosDiv = document.getElementById('busca-global-resultados');
  let timeout;

  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const termo = input.value.trim();
    if (termo.length < 2) { resultadosDiv.classList.add('hidden'); return; }
    timeout = setTimeout(async () => {
      const porNome = await buscarEscolas({ nome: termo });
      const porMunicipio = await buscarEscolas({ municipio: termo });
      const mapa = new Map();
      [...porNome, ...porMunicipio].forEach((e) => mapa.set(e.id, e));
      const resultados = Array.from(mapa.values()).slice(0, 10);

      if (!resultados.length) {
        resultadosDiv.innerHTML = '<div class="item">Nenhuma escola encontrada (verifique se a UF já foi carregada na Consulta de escolas)</div>';
      } else {
        resultadosDiv.innerHTML = resultados.map((e) => `
          <div class="item" data-id="${e.id}">
            <div class="nome">${e.nome}</div>
            <div class="meta">${e.municipio}/${e.uf} · CNPJ ${e.cnpj || '-'}</div>
          </div>`).join('') + `<div class="item" data-vertodos="1"><strong>Ver todos os resultados na Consulta de escolas →</strong></div>`;
      }
      resultadosDiv.classList.remove('hidden');

      resultadosDiv.querySelectorAll('.item[data-id]').forEach((el) => {
        el.addEventListener('click', () => {
          abrirPainelEscola(Number(el.dataset.id));
          resultadosDiv.classList.add('hidden');
          input.value = '';
        });
      });
      const verTodos = resultadosDiv.querySelector('[data-vertodos]');
      if (verTodos) {
        verTodos.addEventListener('click', () => {
          window.location.href = `${prefixo}pages/busca.html?nome=${encodeURIComponent(termo)}`;
        });
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search')) resultadosDiv.classList.add('hidden');
  });
}
