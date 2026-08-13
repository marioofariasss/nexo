const CHAVE_TEMA = 'kedu_crm_tema';

export function aplicarTemaSalvo() {
  const tema = localStorage.getItem(CHAVE_TEMA) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', tema);
  return tema;
}

export function alternarTema() {
  const atual = document.documentElement.getAttribute('data-theme');
  const novo = atual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', novo);
  localStorage.setItem(CHAVE_TEMA, novo);
  return novo;
}
