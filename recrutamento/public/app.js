/* ------------------------------------------------------------------ *
 * Sistema de Recrutamento — app do navegador (sem frameworks).
 * Funciona de dois jeitos:
 *   1) servido por `node server.js`  -> grava em dados/base.json
 *   2) abrindo o index.html direto   -> grava no próprio navegador
 * ------------------------------------------------------------------ */

const ETAPAS_PADRAO = [
  'Mapeado', 'Abordado', 'Entrevista consultor', 'Short list',
  'Entrevista cliente', 'Proposta', 'Contratado'
];
const SITUACOES = ['Ativo', 'Stand-by', 'Declinou', 'Descartado', 'Contratado'];
const STATUS_ASSIGNMENT = ['Aberto', 'Stand-by', 'Concluído', 'Cancelado'];
const SENIORIDADES = ['Analista', 'Coordenação', 'Gerência', 'Diretoria', 'C-level', 'Conselho'];
const DIAS_PARADO = 14; // alerta de candidato parado na mesma etapa

let base = baseVazia();
let modoLocal = false;   // true = sem servidor, guardando no navegador
let salvando = null;

function baseVazia() {
  return { versao: 1, candidatos: [], clientes: [], assignments: [], atividades: [] };
}

/* ---------------------------- utilidades ---------------------------- */

const $ = (s, raiz) => (raiz || document).querySelector(s);
const $$ = (s, raiz) => Array.from((raiz || document).querySelectorAll(s));

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hoje() { return new Date().toISOString(); }

function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('pt-BR');
}

function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function nl2br(t) { return esc(t).replace(/\n/g, '<br>'); }

function aviso(texto, ms) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.remove('escondido');
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => el.classList.add('escondido'), ms || 2600);
}

function baixar(nomeArquivo, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: (tipo || 'text/plain') + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function csv(linhas) {
  return linhas.map((l) => l.map((c) => {
    const v = c == null ? '' : String(c);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(';')).join('\n');
}

/* ---------------------------- persistência ---------------------------- */

async function carregar() {
  try {
    const r = await fetch('api/base', { cache: 'no-store' });
    if (!r.ok) throw new Error('sem api');
    base = Object.assign(baseVazia(), await r.json());
    modoLocal = false;
  } catch (e) {
    modoLocal = true;
    try { base = Object.assign(baseVazia(), JSON.parse(localStorage.getItem('recrut.base') || 'null') || {}); }
    catch (_) { base = baseVazia(); }
  }
  marcarModo();
}

function salvar() {
  clearTimeout(salvando);
  salvando = setTimeout(async () => {
    if (modoLocal) {
      localStorage.setItem('recrut.base', JSON.stringify(base));
      return;
    }
    try {
      const r = await fetch('api/base', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base)
      });
      if (r.status === 409) {
        aviso('Outra pessoa gravou antes. Recarregando a base…', 5000);
        await carregar();
        render();
        return;
      }
      const resp = await r.json();
      if (resp && resp.versao) base.versao = resp.versao;
    } catch (e) {
      aviso('Não consegui gravar no servidor. Verifique se ele está rodando.', 5000);
    }
  }, 180);
}

function marcarModo() {
  const el = $('#aviso-modo');
  if (modoLocal) {
    el.textContent = 'modo navegador';
    el.title = 'Sem servidor: os dados ficam salvos apenas neste navegador. Use "Backup" para exportar.';
  } else {
    el.textContent = 'servidor local';
    el.title = 'Os dados ficam em dados/base.json, na pasta do projeto.';
  }
}

function registrarAtividade(tipo, texto, extra) {
  base.atividades = base.atividades || [];
  base.atividades.unshift(Object.assign({ id: uid(), data: hoje(), tipo, texto }, extra || {}));
  base.atividades = base.atividades.slice(0, 500);
}

/* ---------------------------- acessores ---------------------------- */

const acharCandidato = (id) => base.candidatos.find((c) => c.id === id);
const acharCliente = (id) => base.clientes.find((c) => c.id === id);
const acharAssignment = (id) => base.assignments.find((a) => a.id === id);
const nomeCliente = (id) => (acharCliente(id) || {}).nome || '—';
const etapasDe = (a) => (a.etapas && a.etapas.length ? a.etapas : ETAPAS_PADRAO);

function processosDoCandidato(candidatoId) {
  const saida = [];
  base.assignments.forEach((a) => {
    (a.candidatos || []).forEach((v) => {
      if (v.candidatoId === candidatoId) saida.push({ assignment: a, vinculo: v });
    });
  });
  return saida;
}

/* ---------------------------- modal ---------------------------- */

function abrirModal(titulo, html, aoAbrir) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').classList.remove('escondido');
  ligarAcoes($('#modal-corpo'));
  if (aoAbrir) aoAbrir($('#modal-corpo'));
}
function fecharModal() {
  $('#modal').classList.add('escondido');
  $('#modal-corpo').innerHTML = '';
}

/* ---------------------------- importador do LinkedIn ---------------------------- */
/**
 * Lê o texto copiado de um perfil do LinkedIn (Ctrl+A / Ctrl+C na página do
 * perfil, ou o texto do PDF "Salvar como PDF") e devolve os campos separados.
 * É heurístico de propósito: o resultado sempre passa por uma tela de revisão
 * antes de virar cadastro.
 */
function importarLinkedIn(texto) {
  const bruto = String(texto || '').replace(/\r/g, '');
  const ruido = /^(ver perfil|status|logotipo|imagem de plano de fundo|foto de|conex|seguidores|mensagem|conectar|mais|salvar no pdf|entre para ver|carregar mais|·\s*3º|·\s*2º|·\s*1º)/i;

  const linhas = bruto.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !ruido.test(l))
    .filter((l, i, arr) => l !== arr[i - 1]); // LinkedIn duplica muita linha

  const perfil = {
    nome: '', headline: '', localizacao: '', linkedinUrl: '', resumo: '',
    experiencias: [], formacao: [], competencias: [], idiomas: [],
    empresaAtual: '', cargoAtual: ''
  };

  const mUrl = bruto.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%À-ÿ]+/i);
  if (mUrl) perfil.linkedinUrl = (mUrl[0].startsWith('http') ? '' : 'https://') + mUrl[0];

  const secoes = {
    sobre: /^(sobre|about)$/i,
    experiencia: /^(experiência|experiencia|experience)$/i,
    formacao: /^(formação acadêmica|formacao academica|educação|education)$/i,
    licencas: /^(licenças e certificados|licenses|certificações|certificacoes)$/i,
    competencias: /^(competências|competencias|skills|principais competências)$/i,
    idiomas: /^(idiomas|languages)$/i,
    fim: /^(recomendações|interesses|atividades|publicações|conquistas|cursos|voluntariado|pessoas que|outros perfis)/i
  };

  // 1) cabeçalho: nome, headline e localização (antes da 1ª seção conhecida)
  let i = 0;
  const ehSecao = (l) => Object.keys(secoes).some((k) => secoes[k].test(l));
  const cabeca = [];
  while (i < linhas.length && !ehSecao(linhas[i]) && cabeca.length < 8) { cabeca.push(linhas[i]); i++; }

  const semUrl = cabeca.filter((l) => !/linkedin\.com/i.test(l));
  perfil.nome = semUrl[0] || '';
  perfil.headline = semUrl[1] || '';
  const iLocal = semUrl.findIndex((l, idx) => idx > 0 &&
    (/(brasil|brazil|portugal|estados unidos)/i.test(l) || /^[^,]{2,30},\s*[^,]{2,30}(,\s*[^,]{2,30})?$/.test(l)) &&
    l.length < 70);
  if (iLocal > 0) perfil.localizacao = semUrl[iLocal].split('·')[0].trim();

  // 2) fatia o resto em blocos por seção
  const blocos = {};
  let atual = null;
  for (; i < linhas.length; i++) {
    const l = linhas[i];
    const chave = Object.keys(secoes).find((k) => secoes[k].test(l));
    if (chave) { atual = chave === 'fim' ? null : chave; if (!blocos[atual]) blocos[atual] = []; continue; }
    if (atual) blocos[atual].push(l);
  }

  if (blocos.sobre) perfil.resumo = blocos.sobre.join('\n');
  if (blocos.competencias) {
    perfil.competencias = blocos.competencias
      .flatMap((l) => l.split(/[•·,;|]/))
      .map((s) => s.trim())
      .filter((s) => s && s.length < 45 && !/^\d+$/.test(s))
      .slice(0, 40);
  }
  if (blocos.idiomas) {
    perfil.idiomas = blocos.idiomas.filter((l) => l.length < 60).slice(0, 12);
  }

  // 3) experiências: cada bloco termina numa linha de período
  const rePeriodo = /((jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?\s*(de\s*)?\d{4}|\b\d{4})\s*[-–—]\s*(o momento|atual|present|(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.?\s*(de\s*)?\d{4}|\d{4})/i;
  const reDuracao = /^\s*(·\s*)?\d+\s*(ano|anos|mês|meses|mes|meses)/i;

  /**
   * Num perfil do LinkedIn cada entrada vem assim:
   *   Cargo / Empresa · tipo / Período / Local / descrição...
   * Então cada linha de período é uma âncora: o que vem logo antes dela é
   * cargo/empresa e o que vem depois é local/descrição, até a próxima entrada.
   */
  function entradasPorPeriodo(linhasSecao) {
    const uteis = linhasSecao.filter((l) => !reDuracao.test(l));
    const ancoras = [];
    uteis.forEach((l, i) => { if (rePeriodo.test(l)) ancoras.push(i); });
    if (!ancoras.length) return [];
    return ancoras.map((iPer, k) => {
      const inicio = k === 0 ? 0 : ancoras[k - 1] + 1;
      const antes = uteis.slice(inicio, iPer);
      const limite = k + 1 < ancoras.length ? Math.max(iPer + 1, ancoras[k + 1] - 2) : uteis.length;
      const depois = uteis.slice(iPer + 1, limite);
      return {
        titulo: (antes[antes.length - 2] || antes[0] || '').trim(),
        sub: (antes.length > 1 ? antes[antes.length - 1] : '').split('·')[0].trim(),
        periodo: uteis[iPer].split('·')[0].trim(),
        extra: depois
      };
    });
  }

  if (blocos.experiencia) {
    entradasPorPeriodo(blocos.experiencia).forEach((e) => {
      if (!e.titulo && !e.sub) return;
      const local = e.extra[0] && e.extra[0].length < 60 ? e.extra[0] : '';
      const descricao = (local ? e.extra.slice(1) : e.extra).join('\n');
      perfil.experiencias.push({ cargo: e.titulo, empresa: e.sub, periodo: e.periodo, local, descricao });
    });
  }

  if (blocos.formacao) {
    entradasPorPeriodo(blocos.formacao).forEach((e) => {
      if (!e.titulo && !e.sub) return;
      perfil.formacao.push({ instituicao: e.titulo, curso: e.sub, periodo: e.periodo });
    });
  }

  const atualExp = perfil.experiencias.find((e) => /(o momento|atual|present)/i.test(e.periodo)) || perfil.experiencias[0];
  if (atualExp) { perfil.cargoAtual = atualExp.cargo; perfil.empresaAtual = atualExp.empresa; }
  if (!perfil.cargoAtual && perfil.headline) {
    const p = perfil.headline.split(/\s+(?:na|no|em|@|\|)\s+/i);
    perfil.cargoAtual = (p[0] || '').trim();
    perfil.empresaAtual = (p[1] || '').trim();
  }

  const mEmail = bruto.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  const mTel = bruto.match(/(\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/);
  if (mEmail) perfil.email = mEmail[0];
  if (mTel) perfil.telefone = mTel[0];

  return perfil;
}

/* ---------------------------- roteamento ---------------------------- */

const acoes = {}; // nome -> função(elemento, dataset)

function ligarAcoes(raiz) {
  $$('[data-acao]', raiz || document).forEach((el) => {
    if (el._ligado) return;
    el._ligado = true;
    const evento = el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      ? 'change' : 'click';
    el.addEventListener(evento, (ev) => {
      const fn = acoes[el.dataset.acao];
      if (fn) { ev.preventDefault(); fn(el, el.dataset, ev); }
    });
  });
}

function ir(hash) { location.hash = hash; }

function render() {
  const rota = (location.hash || '#/painel').slice(1);
  const partes = rota.split('/').filter(Boolean);
  const app = $('#app');
  let html = '';

  const tela = partes[0] || 'painel';
  const arg = partes[1];
  const arg2 = partes[2];

  if (tela === 'painel') html = telaPainel();
  else if (tela === 'assignments') html = telaAssignments();
  else if (tela === 'assignment') html = telaAssignment(arg);
  else if (tela === 'candidatos') html = telaCandidatos();
  else if (tela === 'candidato') html = telaCandidato(arg);
  else if (tela === 'clientes') html = telaClientes();
  else if (tela === 'relatorios') html = telaRelatorios();
  else if (tela === 'relatorio') html = arg === 'assignment' ? relatorioAssignment(arg2) : relatorioCandidato(arg2);
  else html = telaPainel();

  app.innerHTML = html;
  ligarAcoes(app);
  ligarKanban();
  if ($('#rel-busca-cand')) ligarBuscaRelatorio();

  $$('.menu a').forEach((a) => {
    const r = a.dataset.rota;
    const ativo = tela === r || (tela === 'assignment' && r === 'assignments') ||
      (tela === 'candidato' && r === 'candidatos') || (tela === 'relatorio' && r === 'relatorios');
    a.classList.toggle('ativo', ativo);
  });
  window.scrollTo(0, 0);
}

/* ---------------------------- painel ---------------------------- */

function contagemPorEtapa(a) {
  const mapa = {};
  etapasDe(a).forEach((e) => { mapa[e] = 0; });
  (a.candidatos || []).forEach((v) => {
    if (v.situacao && v.situacao !== 'Ativo' && v.situacao !== 'Contratado') return;
    if (mapa[v.etapa] == null) mapa[v.etapa] = 0;
    mapa[v.etapa]++;
  });
  return mapa;
}

function barraFunil(a) {
  const mapa = contagemPorEtapa(a);
  const total = Object.values(mapa).reduce((s, n) => s + n, 0) || 1;
  const cores = ['#4f9cf9', '#5aa9e6', '#69b3a2', '#8bbf6e', '#c8b34b', '#e2a83b', '#2ea36b'];
  const etapas = etapasDe(a);
  const pedacos = etapas.map((e, i) => {
    const n = mapa[e] || 0;
    if (!n) return '';
    return `<span title="${esc(e)}: ${n}" style="width:${(n / total) * 100}%;background:${cores[i % cores.length]}"></span>`;
  }).join('');
  return `<div class="funil">${pedacos}</div>`;
}

function telaPainel() {
  const abertos = base.assignments.filter((a) => a.status === 'Aberto');
  const emProcesso = base.assignments.reduce((s, a) =>
    s + (a.candidatos || []).filter((v) => (v.situacao || 'Ativo') === 'Ativo').length, 0);
  const contratados = base.assignments.reduce((s, a) =>
    s + (a.candidatos || []).filter((v) => v.situacao === 'Contratado').length, 0);

  const parados = [];
  base.assignments.filter((a) => a.status === 'Aberto').forEach((a) => {
    (a.candidatos || []).forEach((v) => {
      const d = diasDesde(v.etapaDesde || v.entrouEm);
      if ((v.situacao || 'Ativo') === 'Ativo' && d != null && d >= DIAS_PARADO) {
        parados.push({ a, v, d });
      }
    });
  });
  parados.sort((x, y) => y.d - x.d);

  const linhasAssign = abertos.map((a) => {
    const total = (a.candidatos || []).length;
    const dias = diasDesde(a.abertoEm);
    return `<tr class="clicavel" data-acao="abrirAssignment" data-id="${a.id}">
      <td><strong>${esc(a.titulo)}</strong><div class="subtexto">${esc(nomeCliente(a.clienteId))}</div></td>
      <td>${esc(a.consultor || '—')}</td>
      <td>${total}${barraFunil(a)}</td>
      <td>${dias == null ? '—' : dias + ' d'}</td>
      <td>${a.prazoAlvo ? fmtData(a.prazoAlvo) : '—'}</td>
    </tr>`;
  }).join('');

  const atividades = (base.atividades || []).slice(0, 12).map((at) =>
    `<li><div>${esc(at.texto)}</div><div class="q">${fmtData(at.data)}</div></li>`).join('');

  return `
  <div class="linha" style="margin-bottom:14px">
    <h1>Painel</h1>
    <div class="espaco"></div>
    <button class="btn" data-acao="novoAssignment">+ Novo assignment</button>
    <button class="btn btn-sec" data-acao="novoCandidatoLinkedIn">+ Candidato (LinkedIn)</button>
  </div>

  <div class="grade g4" style="margin-bottom:16px">
    <div class="kpi"><div class="n">${abertos.length}</div><div class="r">assignments abertos</div></div>
    <div class="kpi"><div class="n">${base.candidatos.length}</div><div class="r">profissionais no banco</div></div>
    <div class="kpi"><div class="n">${emProcesso}</div><div class="r">em processo ativo</div></div>
    <div class="kpi"><div class="n">${contratados}</div><div class="r">contratados</div></div>
  </div>

  <div class="cartao">
    <h2>Assignments abertos</h2>
    ${abertos.length ? `<table><thead><tr><th>Posição</th><th>Consultor</th><th>Pipeline</th><th>Em aberto</th><th>Prazo</th></tr></thead><tbody>${linhasAssign}</tbody></table>`
      : '<div class="vazio">Nenhum assignment aberto. Comece criando um.</div>'}
  </div>

  <div class="grade g2">
    <div class="cartao">
      <h2>Precisa de atenção <span class="tag tag-amarela">${parados.length}</span></h2>
      <div class="subtexto" style="margin-bottom:8px">Candidatos parados há ${DIAS_PARADO} dias ou mais na mesma etapa.</div>
      ${parados.length ? `<table><tbody>${parados.slice(0, 10).map(({ a, v, d }) => {
        const c = acharCandidato(v.candidatoId) || {};
        return `<tr class="clicavel" data-acao="abrirAssignment" data-id="${a.id}">
          <td><strong>${esc(c.nome || '—')}</strong><div class="subtexto">${esc(a.titulo)} · ${esc(v.etapa)}</div></td>
          <td style="text-align:right"><span class="tag tag-amarela">${d} d</span></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="subtexto">Tudo em dia.</div>'}
    </div>
    <div class="cartao">
      <h2>Últimas movimentações</h2>
      ${atividades ? `<ul class="timeline">${atividades}</ul>` : '<div class="subtexto">Sem movimentações ainda.</div>'}
    </div>
  </div>`;
}

/* ---------------------------- assignments ---------------------------- */

function telaAssignments() {
  const filtro = (telaAssignments.filtro || '').toLowerCase();
  const situacao = telaAssignments.situacao || 'Aberto';
  const lista = base.assignments.filter((a) => {
    if (situacao !== 'Todos' && a.status !== situacao) return false;
    if (!filtro) return true;
    return (a.titulo + ' ' + nomeCliente(a.clienteId) + ' ' + (a.cargo || '')).toLowerCase().includes(filtro);
  });

  const linhas = lista.map((a) => {
    const mapa = contagemPorEtapa(a);
    const ativos = (a.candidatos || []).filter((v) => (v.situacao || 'Ativo') === 'Ativo').length;
    return `<tr class="clicavel" data-acao="abrirAssignment" data-id="${a.id}">
      <td><strong>${esc(a.titulo)}</strong><div class="subtexto">${esc(a.cargo || '')} ${a.localizacao ? '· ' + esc(a.localizacao) : ''}</div></td>
      <td>${esc(nomeCliente(a.clienteId))}</td>
      <td><span class="tag ${a.status === 'Aberto' ? 'tag-azul' : a.status === 'Concluído' ? 'tag-verde' : 'tag-cinza'}">${esc(a.status)}</span></td>
      <td>${ativos} ativos / ${(a.candidatos || []).length} no total ${barraFunil(a)}</td>
      <td>${fmtData(a.abertoEm)}</td>
    </tr>`;
  }).join('');

  return `
  <div class="linha" style="margin-bottom:14px">
    <h1>Assignments</h1>
    <div class="espaco"></div>
    <button class="btn" data-acao="novoAssignment">+ Novo assignment</button>
  </div>
  <div class="cartao">
    <div class="linha" style="margin-bottom:10px">
      <input id="busca-assign" placeholder="Buscar por posição, cliente ou cargo" value="${esc(telaAssignments.filtro || '')}" style="max-width:340px" data-acao="filtrarAssignments">
      <select style="max-width:170px" data-acao="situacaoAssignments">
        ${['Aberto', 'Stand-by', 'Concluído', 'Cancelado', 'Todos'].map((s) =>
          `<option ${s === situacao ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    ${lista.length ? `<table><thead><tr><th>Posição</th><th>Cliente</th><th>Status</th><th>Pipeline</th><th>Aberto em</th></tr></thead><tbody>${linhas}</tbody></table>`
      : '<div class="vazio">Nenhum assignment nesse filtro.</div>'}
  </div>`;
}

function formAssignment(a) {
  a = a || {};
  const clientes = base.clientes.map((c) =>
    `<option value="${c.id}" ${c.id === a.clienteId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  return `
  <div class="grade g2">
    <div class="campo"><label>Posição / título do assignment *</label>
      <input id="f-titulo" value="${esc(a.titulo || '')}" placeholder="Ex.: Diretor Comercial LATAM"></div>
    <div class="campo"><label>Cliente</label>
      <select id="f-cliente"><option value="">— selecione —</option>${clientes}</select>
      <div class="subtexto" style="margin-top:4px">Cadastre clientes na aba Clientes.</div></div>
    <div class="campo"><label>Cargo</label><input id="f-cargo" value="${esc(a.cargo || '')}"></div>
    <div class="campo"><label>Local</label><input id="f-local" value="${esc(a.localizacao || '')}"></div>
    <div class="campo"><label>Senioridade</label>
      <select id="f-senioridade"><option value="">—</option>
      ${SENIORIDADES.map((s) => `<option ${s === a.senioridade ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="campo"><label>Consultor responsável</label><input id="f-consultor" value="${esc(a.consultor || '')}"></div>
    <div class="campo"><label>Faixa salarial / pacote</label><input id="f-faixa" value="${esc(a.faixaSalarial || '')}"></div>
    <div class="campo"><label>Prazo alvo</label><input id="f-prazo" type="date" value="${(a.prazoAlvo || '').slice(0, 10)}"></div>
    <div class="campo"><label>Status</label>
      <select id="f-status">${STATUS_ASSIGNMENT.map((s) =>
        `<option ${s === (a.status || 'Aberto') ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="campo"><label>Aberto em</label>
      <input id="f-abertura" type="date" value="${(a.abertoEm || hoje()).slice(0, 10)}"></div>
  </div>
  <div class="campo"><label>Descritivo da posição (job spec)</label>
    <textarea id="f-descricao" placeholder="Contexto, desafios, entregas esperadas, perfil ideal">${esc(a.descricao || '')}</textarea></div>
  <div class="campo"><label>Etapas do processo (uma por linha — dá para adaptar por assignment)</label>
    <textarea id="f-etapas">${esc((a.etapas && a.etapas.length ? a.etapas : ETAPAS_PADRAO).join('\n'))}</textarea></div>
  <div class="linha">
    <button class="btn" data-acao="salvarAssignment" data-id="${a.id || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    ${a.id ? '<button class="btn btn-perigo espaco" data-acao="excluirAssignment" data-id="' + a.id + '">Excluir</button>' : ''}
  </div>`;
}

acoes.novoAssignment = () => abrirModal('Novo assignment', formAssignment(null));
acoes.editarAssignment = (el, d) => abrirModal('Editar assignment', formAssignment(acharAssignment(d.id)));
acoes.fecharModal = () => fecharModal();
acoes.abrirAssignment = (el, d) => ir('#/assignment/' + d.id);

acoes.salvarAssignment = (el, d) => {
  const titulo = $('#f-titulo').value.trim();
  if (!titulo) { aviso('Dê um título para o assignment.'); return; }
  let a = d.id ? acharAssignment(d.id) : null;
  const novo = !a;
  if (novo) { a = { id: uid(), candidatos: [], criadoEm: hoje() }; base.assignments.push(a); }
  a.titulo = titulo;
  a.clienteId = $('#f-cliente').value;
  a.cargo = $('#f-cargo').value.trim();
  a.localizacao = $('#f-local').value.trim();
  a.senioridade = $('#f-senioridade').value;
  a.consultor = $('#f-consultor').value.trim();
  a.faixaSalarial = $('#f-faixa').value.trim();
  a.prazoAlvo = $('#f-prazo').value;
  a.status = $('#f-status').value;
  a.abertoEm = $('#f-abertura').value || hoje();
  a.descricao = $('#f-descricao').value;
  a.etapas = $('#f-etapas').value.split('\n').map((s) => s.trim()).filter(Boolean);
  registrarAtividade('assignment', `${novo ? 'Assignment criado' : 'Assignment atualizado'}: ${a.titulo}`, { assignmentId: a.id });
  salvar(); fecharModal();
  if (novo) ir('#/assignment/' + a.id); else render();
};

acoes.excluirAssignment = (el, d) => {
  if (!confirm('Excluir este assignment e todo o pipeline dele?')) return;
  base.assignments = base.assignments.filter((a) => a.id !== d.id);
  salvar(); fecharModal(); ir('#/assignments'); render();
};

acoes.filtrarAssignments = (el) => { telaAssignments.filtro = el.value; render(); setTimeout(() => { const b = $('#busca-assign'); if (b) { b.focus(); b.selectionStart = b.value.length; } }, 0); };
acoes.situacaoAssignments = (el) => { telaAssignments.situacao = el.value; render(); };

/* ---------------------------- assignment: pipeline ---------------------------- */

function fichaCandidato(a, v) {
  const c = acharCandidato(v.candidatoId) || { nome: '(removido)' };
  const d = diasDesde(v.etapaDesde || v.entrouEm);
  const parado = (v.situacao || 'Ativo') === 'Ativo' && d != null && d >= DIAS_PARADO;
  return `<div class="ficha ${parado ? 'parado' : ''}" draggable="true"
      data-candidato="${v.candidatoId}" data-assignment="${a.id}"
      data-acao="abrirVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">
    <strong>${esc(c.nome)}</strong>
    <div class="sub">${esc(c.cargoAtual || c.headline || '')}${c.empresaAtual ? ' · ' + esc(c.empresaAtual) : ''}</div>
    <div class="linha" style="margin-top:6px;gap:4px">
      ${v.fit ? `<span class="tag tag-azul">fit ${esc(v.fit)}/5</span>` : ''}
      ${d != null ? `<span class="tag ${parado ? 'tag-amarela' : ''}">${d} d</span>` : ''}
      ${v.situacao && v.situacao !== 'Ativo' ? `<span class="tag ${v.situacao === 'Contratado' ? 'tag-verde' : 'tag-vermelha'}">${esc(v.situacao)}</span>` : ''}
    </div>
  </div>`;
}

function telaAssignment(id) {
  const a = acharAssignment(id);
  if (!a) return '<div class="vazio">Assignment não encontrado.</div>';
  const etapas = etapasDe(a);
  const ativos = (a.candidatos || []).filter((v) => ['Ativo', 'Contratado'].includes(v.situacao || 'Ativo'));
  const fora = (a.candidatos || []).filter((v) => !['Ativo', 'Contratado'].includes(v.situacao || 'Ativo'));

  const colunas = etapas.map((e) => {
    const naEtapa = ativos.filter((v) => v.etapa === e);
    return `<div class="coluna" data-etapa="${esc(e)}" data-assignment="${a.id}">
      <h4><span>${esc(e)}</span><span>${naEtapa.length}</span></h4>
      ${naEtapa.map((v) => fichaCandidato(a, v)).join('') || '<div class="subtexto" style="font-size:12px">—</div>'}
    </div>`;
  }).join('');

  return `
  <div class="linha" style="margin-bottom:6px">
    <div>
      <h1 style="margin-bottom:2px">${esc(a.titulo)}</h1>
      <div class="subtexto">${esc(nomeCliente(a.clienteId))}${a.localizacao ? ' · ' + esc(a.localizacao) : ''}${a.consultor ? ' · ' + esc(a.consultor) : ''}</div>
    </div>
    <div class="espaco"></div>
    <span class="tag ${a.status === 'Aberto' ? 'tag-azul' : 'tag-cinza'}">${esc(a.status)}</span>
    <button class="btn" data-acao="adicionarAoAssignment" data-id="${a.id}">+ Candidato</button>
    <button class="btn btn-sec" data-acao="verRelatorioAssignment" data-id="${a.id}">Relatório</button>
    <button class="btn btn-fantasma" data-acao="editarAssignment" data-id="${a.id}">Editar</button>
  </div>

  <div class="grade g4" style="margin:12px 0">
    <div class="kpi"><div class="n">${(a.candidatos || []).length}</div><div class="r">mapeados no total</div></div>
    <div class="kpi"><div class="n">${ativos.filter((v) => (v.situacao || 'Ativo') === 'Ativo').length}</div><div class="r">ativos no funil</div></div>
    <div class="kpi"><div class="n">${(a.candidatos || []).filter((v) => v.etapa === 'Short list').length}</div><div class="r">na short list</div></div>
    <div class="kpi"><div class="n">${diasDesde(a.abertoEm) == null ? '—' : diasDesde(a.abertoEm)}</div><div class="r">dias em aberto</div></div>
  </div>

  ${a.descricao ? `<div class="cartao"><h3>Descritivo da posição</h3><div class="subtexto">${nl2br(a.descricao)}</div>
    ${a.faixaSalarial ? `<div style="margin-top:8px"><span class="tag">Pacote: ${esc(a.faixaSalarial)}</span> ${a.prazoAlvo ? `<span class="tag">Prazo: ${fmtData(a.prazoAlvo)}</span>` : ''}</div>` : ''}</div>` : ''}

  <h2>Pipeline <span class="subtexto" style="font-weight:400">— arraste as fichas entre as etapas</span></h2>
  <div class="kanban">${colunas}</div>

  ${fora.length ? `<div class="cartao"><h3>Fora do processo (${fora.length})</h3>
    <table><tbody>${fora.map((v) => {
      const c = acharCandidato(v.candidatoId) || {};
      return `<tr class="clicavel" data-acao="abrirVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">
        <td><strong>${esc(c.nome || '—')}</strong><div class="subtexto">${esc(c.cargoAtual || '')}</div></td>
        <td><span class="tag tag-vermelha">${esc(v.situacao)}</span></td>
        <td class="subtexto">${esc(v.motivo || '')}</td></tr>`;
    }).join('')}</tbody></table></div>` : ''}`;
}

function ligarKanban() {
  let arrastando = null;
  $$('.ficha').forEach((f) => {
    f.addEventListener('dragstart', (e) => {
      arrastando = { cid: f.dataset.candidato, aid: f.dataset.assignment };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', f.dataset.candidato); } catch (_) {}
    });
  });
  $$('.coluna').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('destino'); });
    col.addEventListener('dragleave', () => col.classList.remove('destino'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('destino');
      if (!arrastando) return;
      moverEtapa(arrastando.aid, arrastando.cid, col.dataset.etapa);
      arrastando = null;
    });
  });
}

function moverEtapa(assignmentId, candidatoId, etapa, obs) {
  const a = acharAssignment(assignmentId);
  if (!a) return;
  const v = (a.candidatos || []).find((x) => x.candidatoId === candidatoId);
  if (!v || v.etapa === etapa) return;
  const c = acharCandidato(candidatoId) || {};
  v.historico = v.historico || [];
  v.historico.push({ etapa, data: hoje(), de: v.etapa, obs: obs || '' });
  v.etapa = etapa;
  v.etapaDesde = hoje();
  if (etapa === 'Contratado') v.situacao = 'Contratado';
  registrarAtividade('etapa', `${c.nome || 'Candidato'} → ${etapa} (${a.titulo})`, { assignmentId: a.id, candidatoId });
  salvar();
  render();
}

acoes.verRelatorioAssignment = (el, d) => ir('#/relatorio/assignment/' + d.id);

/* ---- vínculo candidato x assignment ---- */

function formVinculo(a, v) {
  const c = acharCandidato(v.candidatoId) || {};
  const etapas = etapasDe(a);
  const hist = (v.historico || []).slice().reverse().map((h) =>
    `<li><div>${esc(h.de || '—')} → <strong>${esc(h.etapa)}</strong>${h.obs ? ' — ' + esc(h.obs) : ''}</div><div class="q">${fmtData(h.data)}</div></li>`).join('');
  const notas = (v.notas || []).slice().reverse().map((n) =>
    `<li><div>${nl2br(n.texto)}</div><div class="q">${fmtData(n.data)}${n.autor ? ' · ' + esc(n.autor) : ''}</div></li>`).join('');

  return `
  <div class="linha" style="margin-bottom:10px">
    <div><strong style="font-size:16px">${esc(c.nome || '—')}</strong>
      <div class="subtexto">${esc(c.cargoAtual || '')}${c.empresaAtual ? ' · ' + esc(c.empresaAtual) : ''}</div></div>
    <div class="espaco"></div>
    <button class="btn btn-fantasma" data-acao="abrirCandidato" data-cid="${v.candidatoId}">Ver perfil completo</button>
  </div>
  <div class="grade g3">
    <div class="campo"><label>Etapa</label>
      <select id="v-etapa">${etapas.map((e) => `<option ${e === v.etapa ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
    <div class="campo"><label>Situação</label>
      <select id="v-situacao">${SITUACOES.map((s) => `<option ${s === (v.situacao || 'Ativo') ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="campo"><label>Aderência (fit)</label>
      <select id="v-fit"><option value="">—</option>${[1, 2, 3, 4, 5].map((n) =>
        `<option ${String(n) === String(v.fit) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
  </div>
  <div class="campo"><label>Motivo / observação da situação (ex.: por que saiu do processo)</label>
    <input id="v-motivo" value="${esc(v.motivo || '')}"></div>
  <div class="campo"><label>Parecer do consultor sobre este candidato para esta posição</label>
    <textarea id="v-parecer">${esc(v.parecer || '')}</textarea></div>
  <div class="linha" style="margin-bottom:14px">
    <button class="btn" data-acao="salvarVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    <button class="btn btn-perigo espaco" data-acao="removerVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">Tirar do processo</button>
  </div>
  <div class="campo"><label>Nova anotação (contato, entrevista, feedback do cliente…)</label>
    <textarea id="v-nota" placeholder="Ex.: Falei por telefone. Aberto a conversar, pretensão R$ ..."></textarea>
    <button class="btn btn-sec btn-mini" style="margin-top:6px" data-acao="addNotaVinculo" data-id="${a.id}" data-cid="${v.candidatoId}">Adicionar anotação</button></div>
  ${notas ? `<h4>Anotações</h4><ul class="timeline">${notas}</ul>` : ''}
  ${hist ? `<h4>Histórico de etapas</h4><ul class="timeline">${hist}</ul>` : ''}`;
}

acoes.abrirVinculo = (el, d) => {
  const a = acharAssignment(d.id);
  const v = (a.candidatos || []).find((x) => x.candidatoId === d.cid);
  if (!a || !v) return;
  abrirModal('Candidato no processo', formVinculo(a, v));
};

acoes.salvarVinculo = (el, d) => {
  const a = acharAssignment(d.id);
  const v = (a.candidatos || []).find((x) => x.candidatoId === d.cid);
  const novaEtapa = $('#v-etapa').value;
  if (novaEtapa !== v.etapa) {
    v.historico = v.historico || [];
    v.historico.push({ etapa: novaEtapa, de: v.etapa, data: hoje() });
    v.etapa = novaEtapa;
    v.etapaDesde = hoje();
  }
  v.situacao = $('#v-situacao').value;
  v.fit = $('#v-fit').value;
  v.motivo = $('#v-motivo').value.trim();
  v.parecer = $('#v-parecer').value;
  const c = acharCandidato(v.candidatoId) || {};
  registrarAtividade('pipeline', `${c.nome || 'Candidato'} · ${v.etapa} · ${v.situacao} (${a.titulo})`, { assignmentId: a.id, candidatoId: v.candidatoId });
  salvar(); fecharModal(); render();
};

acoes.addNotaVinculo = (el, d) => {
  const a = acharAssignment(d.id);
  const v = (a.candidatos || []).find((x) => x.candidatoId === d.cid);
  const texto = $('#v-nota').value.trim();
  if (!texto) return;
  v.notas = v.notas || [];
  v.notas.push({ data: hoje(), texto });
  const c = acharCandidato(v.candidatoId) || {};
  registrarAtividade('nota', `Anotação sobre ${c.nome || 'candidato'} em ${a.titulo}`, { assignmentId: a.id, candidatoId: v.candidatoId });
  salvar();
  abrirModal('Candidato no processo', formVinculo(a, v));
  aviso('Anotação registrada.');
};

acoes.removerVinculo = (el, d) => {
  if (!confirm('Tirar este candidato do processo? O perfil continua no banco.')) return;
  const a = acharAssignment(d.id);
  a.candidatos = (a.candidatos || []).filter((x) => x.candidatoId !== d.cid);
  salvar(); fecharModal(); render();
};

acoes.adicionarAoAssignment = (el, d) => {
  const a = acharAssignment(d.id);
  const jaTem = new Set((a.candidatos || []).map((v) => v.candidatoId));
  const html = `
    <div class="campo"><input id="busca-cand-modal" placeholder="Buscar no banco por nome, empresa, cargo ou competência" autofocus></div>
    <div id="resultado-busca"></div>
    <div class="linha" style="margin-top:12px">
      <button class="btn btn-sec" data-acao="novoCandidatoLinkedIn" data-id="${a.id}">Importar do LinkedIn</button>
      <button class="btn btn-fantasma" data-acao="novoCandidatoManual" data-id="${a.id}">Cadastrar manualmente</button>
    </div>`;
  abrirModal('Adicionar candidato ao assignment', html, () => {
    const campo = $('#busca-cand-modal');
    const pinta = () => {
      const q = campo.value.trim().toLowerCase();
      const achados = base.candidatos.filter((c) => {
        if (jaTem.has(c.id)) return false;
        if (!q) return true;
        return textoDoCandidato(c).includes(q);
      }).slice(0, 40);
      $('#resultado-busca').innerHTML = achados.length ? `<table><tbody>${achados.map((c) =>
        `<tr class="clicavel" data-acao="vincularCandidato" data-id="${a.id}" data-cid="${c.id}">
          <td><strong>${esc(c.nome)}</strong><div class="subtexto">${esc(c.cargoAtual || c.headline || '')}${c.empresaAtual ? ' · ' + esc(c.empresaAtual) : ''}</div></td>
          <td style="text-align:right"><span class="tag tag-azul">adicionar</span></td></tr>`).join('')}</tbody></table>`
        : '<div class="vazio">Nenhum profissional encontrado. Importe do LinkedIn ou cadastre manualmente.</div>';
      ligarAcoes($('#resultado-busca'));
    };
    campo.addEventListener('input', pinta);
    pinta();
  });
};

acoes.vincularCandidato = (el, d) => {
  const a = acharAssignment(d.id);
  const c = acharCandidato(d.cid);
  if (!a || !c) return;
  a.candidatos = a.candidatos || [];
  if (a.candidatos.some((v) => v.candidatoId === c.id)) { aviso('Já está no processo.'); return; }
  const etapa = etapasDe(a)[0];
  a.candidatos.push({
    candidatoId: c.id, etapa, entrouEm: hoje(), etapaDesde: hoje(),
    situacao: 'Ativo', historico: [{ etapa, data: hoje() }], notas: []
  });
  registrarAtividade('pipeline', `${c.nome} entrou em ${a.titulo} (${etapa})`, { assignmentId: a.id, candidatoId: c.id });
  salvar(); fecharModal(); render();
  aviso(`${c.nome} adicionado.`);
};

/* ---------------------------- candidatos ---------------------------- */

function textoDoCandidato(c) {
  return [c.nome, c.headline, c.cargoAtual, c.empresaAtual, c.localizacao, c.senioridade,
    (c.competencias || []).join(' '), (c.tags || []).join(' '), c.resumo,
    (c.experiencias || []).map((e) => e.cargo + ' ' + e.empresa).join(' ')]
    .join(' ').toLowerCase();
}

function telaCandidatos() {
  const q = (telaCandidatos.filtro || '').toLowerCase();
  const sen = telaCandidatos.senioridade || '';
  const lista = base.candidatos.filter((c) => {
    if (sen && c.senioridade !== sen) return false;
    return !q || textoDoCandidato(c).includes(q);
  }).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  const linhas = lista.slice(0, 300).map((c) => {
    const procs = processosDoCandidato(c.id);
    const cons = (c.consentimento || {}).status;
    return `<tr class="clicavel" data-acao="abrirCandidato" data-cid="${c.id}">
      <td><strong>${esc(c.nome)}</strong><div class="subtexto">${esc(c.headline || '')}</div></td>
      <td>${esc(c.cargoAtual || '')}<div class="subtexto">${esc(c.empresaAtual || '')}</div></td>
      <td>${esc(c.localizacao || '—')}</td>
      <td>${procs.length ? procs.map((p) => `<span class="tag tag-azul">${esc(p.assignment.titulo)}</span>`).join(' ') : '<span class="subtexto">—</span>'}</td>
      <td>${cons === 'concedido' ? '<span class="tag tag-verde">consentimento ok</span>' :
        cons === 'negado' ? '<span class="tag tag-vermelha">recusou</span>' : '<span class="tag tag-amarela">pendente</span>'}</td>
      <td class="subtexto">${fmtData(c.atualizadoEm || c.criadoEm)}</td>
    </tr>`;
  }).join('');

  return `
  <div class="linha" style="margin-bottom:14px">
    <h1>Banco de profissionais</h1>
    <div class="espaco"></div>
    <button class="btn" data-acao="novoCandidatoLinkedIn">+ Importar do LinkedIn</button>
    <button class="btn btn-sec" data-acao="novoCandidatoManual">+ Manual</button>
    <button class="btn btn-fantasma" data-acao="exportarCandidatosCSV">CSV</button>
  </div>
  <div class="cartao">
    <div class="linha" style="margin-bottom:10px">
      <input id="busca-cand" placeholder="Buscar por nome, empresa, cargo, competência…" value="${esc(telaCandidatos.filtro || '')}" style="max-width:380px" data-acao="filtrarCandidatos">
      <select style="max-width:180px" data-acao="filtrarSenioridade">
        <option value="">Toda senioridade</option>
        ${SENIORIDADES.map((s) => `<option ${s === sen ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <span class="subtexto espaco">${lista.length} profissiona${lista.length === 1 ? 'l' : 'is'}</span>
    </div>
    ${lista.length ? `<table><thead><tr><th>Nome</th><th>Posição atual</th><th>Local</th><th>Processos</th><th>LGPD</th><th>Atualizado</th></tr></thead><tbody>${linhas}</tbody></table>`
      : '<div class="vazio">Banco vazio. Importe um perfil do LinkedIn para começar.</div>'}
  </div>`;
}

acoes.filtrarCandidatos = (el) => {
  telaCandidatos.filtro = el.value; render();
  setTimeout(() => { const b = $('#busca-cand'); if (b) { b.focus(); b.selectionStart = b.value.length; } }, 0);
};
acoes.filtrarSenioridade = (el) => { telaCandidatos.senioridade = el.value; render(); };
acoes.abrirCandidato = (el, d) => { fecharModal(); ir('#/candidato/' + d.cid); };

function telaCandidato(id) {
  const c = acharCandidato(id);
  if (!c) return '<div class="vazio">Profissional não encontrado.</div>';
  const procs = processosDoCandidato(c.id);
  const cons = c.consentimento || {};

  const exp = (c.experiencias || []).map((e) => `<li>
    <div><strong>${esc(e.cargo || '')}</strong>${e.empresa ? ' — ' + esc(e.empresa) : ''}</div>
    <div class="q">${esc(e.periodo || '')}</div>
    ${e.descricao ? `<div class="subtexto">${nl2br(e.descricao)}</div>` : ''}</li>`).join('');
  const form = (c.formacao || []).map((f) => `<li>
    <div><strong>${esc(f.instituicao || '')}</strong></div>
    <div class="subtexto">${esc(f.curso || '')}</div><div class="q">${esc(f.periodo || '')}</div></li>`).join('');
  const notas = (c.notas || []).slice().reverse().map((n) =>
    `<li><div>${nl2br(n.texto)}</div><div class="q">${fmtData(n.data)}</div></li>`).join('');

  return `
  <div class="linha" style="margin-bottom:10px">
    <div>
      <h1 style="margin-bottom:2px">${esc(c.nome)}</h1>
      <div class="subtexto">${esc(c.headline || '')}</div>
    </div>
    <div class="espaco"></div>
    <button class="btn" data-acao="editarCandidato" data-cid="${c.id}">Editar</button>
    <button class="btn btn-sec" data-acao="atualizarPeloLinkedIn" data-cid="${c.id}">Atualizar pelo LinkedIn</button>
    <button class="btn btn-sec" data-acao="linkAtualizacao" data-cid="${c.id}">Link de atualização</button>
    <button class="btn btn-fantasma" data-acao="verRelatorioCandidato" data-cid="${c.id}">Relatório</button>
  </div>

  <div class="grade g2">
    <div class="cartao">
      <h3>Dados</h3>
      <table><tbody>
        <tr><th>Posição atual</th><td>${esc(c.cargoAtual || '—')}${c.empresaAtual ? ' — ' + esc(c.empresaAtual) : ''}</td></tr>
        <tr><th>Local</th><td>${esc(c.localizacao || '—')}</td></tr>
        <tr><th>Senioridade</th><td>${esc(c.senioridade || '—')}</td></tr>
        <tr><th>E-mail</th><td>${esc(c.email || '—')}</td></tr>
        <tr><th>Telefone</th><td>${esc(c.telefone || '—')}</td></tr>
        <tr><th>LinkedIn</th><td>${c.linkedinUrl ? `<a href="${esc(c.linkedinUrl)}" target="_blank" rel="noopener">${esc(c.linkedinUrl)}</a>` : '—'}</td></tr>
        <tr><th>Remuneração</th><td>${esc((c.remuneracao || {}).atual || '—')} ${((c.remuneracao || {}).pretendida) ? ' · pretensão: ' + esc(c.remuneracao.pretendida) : ''}</td></tr>
        <tr><th>Disponibilidade</th><td>${esc(c.disponibilidade || '—')}</td></tr>
        <tr><th>Fonte</th><td>${esc(c.fonte || '—')}</td></tr>
        <tr><th>Atualizado</th><td>${fmtData(c.atualizadoEm || c.criadoEm)}</td></tr>
      </tbody></table>
      <div style="margin-top:10px">
        ${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span> `).join('')}
      </div>
    </div>

    <div class="cartao">
      <h3>LGPD</h3>
      <div class="linha" style="margin-bottom:8px">
        ${cons.status === 'concedido' ? '<span class="tag tag-verde">consentimento concedido</span>' :
          cons.status === 'negado' ? '<span class="tag tag-vermelha">titular recusou</span>' :
          '<span class="tag tag-amarela">sem registro de consentimento</span>'}
      </div>
      <div class="subtexto">
        ${cons.data ? `Registrado em ${fmtData(cons.data)}.<br>` : ''}
        ${cons.base ? `Base legal: ${esc(cons.base)}.<br>` : ''}
        ${cons.origem ? `Origem: ${esc(cons.origem)}.` : ''}
      </div>
      <div class="linha" style="margin-top:10px">
        <button class="btn btn-sec btn-mini" data-acao="registrarConsentimento" data-cid="${c.id}">Registrar consentimento</button>
        <button class="btn btn-perigo btn-mini" data-acao="excluirCandidato" data-cid="${c.id}">Excluir dados</button>
      </div>
      <h3 style="margin-top:16px">Processos (${procs.length})</h3>
      ${procs.length ? `<table><tbody>${procs.map((p) =>
        `<tr class="clicavel" data-acao="abrirAssignment" data-id="${p.assignment.id}">
          <td><strong>${esc(p.assignment.titulo)}</strong><div class="subtexto">${esc(nomeCliente(p.assignment.clienteId))}</div></td>
          <td style="text-align:right"><span class="tag tag-azul">${esc(p.vinculo.etapa)}</span></td></tr>`).join('')}</tbody></table>`
        : '<div class="subtexto">Não está em nenhum processo.</div>'}
    </div>
  </div>

  ${c.resumo ? `<div class="cartao"><h3>Resumo</h3><div class="subtexto">${nl2br(c.resumo)}</div></div>` : ''}
  ${exp ? `<div class="cartao"><h3>Experiência</h3><ul class="timeline">${exp}</ul></div>` : ''}
  ${form ? `<div class="cartao"><h3>Formação</h3><ul class="timeline">${form}</ul></div>` : ''}
  ${(c.competencias || []).length ? `<div class="cartao"><h3>Competências</h3>${c.competencias.map((s) => `<span class="tag">${esc(s)}</span> `).join('')}</div>` : ''}
  ${(c.idiomas || []).length ? `<div class="cartao"><h3>Idiomas</h3>${c.idiomas.map((s) => `<span class="tag">${esc(s)}</span> `).join('')}</div>` : ''}

  <div class="cartao">
    <h3>Anotações do consultor</h3>
    <div class="campo"><textarea id="c-nota" placeholder="Registro de conversa, referências, motivações…"></textarea>
      <button class="btn btn-sec btn-mini" style="margin-top:6px" data-acao="addNotaCandidato" data-cid="${c.id}">Adicionar</button></div>
    ${notas ? `<ul class="timeline">${notas}</ul>` : '<div class="subtexto">Sem anotações.</div>'}
  </div>`;
}

acoes.addNotaCandidato = (el, d) => {
  const c = acharCandidato(d.cid);
  const texto = $('#c-nota').value.trim();
  if (!texto) return;
  c.notas = c.notas || [];
  c.notas.push({ data: hoje(), texto });
  registrarAtividade('nota', `Anotação sobre ${c.nome}`, { candidatoId: c.id });
  salvar(); render();
};

acoes.verRelatorioCandidato = (el, d) => ir('#/relatorio/candidato/' + d.cid);

/* ---- formulário de candidato ---- */

function formCandidato(c) {
  c = c || {};
  const r = c.remuneracao || {};
  return `
  <div class="grade g2">
    <div class="campo"><label>Nome *</label><input id="c-nome" value="${esc(c.nome || '')}"></div>
    <div class="campo"><label>Headline / resumo de uma linha</label><input id="c-headline" value="${esc(c.headline || '')}"></div>
    <div class="campo"><label>Cargo atual</label><input id="c-cargo" value="${esc(c.cargoAtual || '')}"></div>
    <div class="campo"><label>Empresa atual</label><input id="c-empresa" value="${esc(c.empresaAtual || '')}"></div>
    <div class="campo"><label>Local</label><input id="c-local" value="${esc(c.localizacao || '')}"></div>
    <div class="campo"><label>Senioridade</label><select id="c-senioridade"><option value="">—</option>
      ${SENIORIDADES.map((s) => `<option ${s === c.senioridade ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="campo"><label>E-mail</label><input id="c-email" value="${esc(c.email || '')}"></div>
    <div class="campo"><label>Telefone</label><input id="c-telefone" value="${esc(c.telefone || '')}"></div>
    <div class="campo"><label>LinkedIn (URL)</label><input id="c-linkedin" value="${esc(c.linkedinUrl || '')}"></div>
    <div class="campo"><label>Disponibilidade / momento de carreira</label><input id="c-disponibilidade" value="${esc(c.disponibilidade || '')}"></div>
    <div class="campo"><label>Remuneração atual</label><input id="c-remun" value="${esc(r.atual || '')}"></div>
    <div class="campo"><label>Pretensão</label><input id="c-pretensao" value="${esc(r.pretendida || '')}"></div>
  </div>
  <div class="campo"><label>Resumo</label><textarea id="c-resumo">${esc(c.resumo || '')}</textarea></div>
  <div class="campo"><label>Competências (separadas por vírgula)</label>
    <input id="c-competencias" value="${esc((c.competencias || []).join(', '))}"></div>
  <div class="campo"><label>Idiomas (separados por vírgula)</label>
    <input id="c-idiomas" value="${esc((c.idiomas || []).join(', '))}"></div>
  <div class="campo"><label>Tags internas (setor, praça, "não abordar", etc.)</label>
    <input id="c-tags" value="${esc((c.tags || []).join(', '))}"></div>
  <div class="campo"><label>Experiência — uma por linha, no formato: Cargo | Empresa | Período</label>
    <textarea id="c-exp">${esc((c.experiencias || []).map((e) => [e.cargo, e.empresa, e.periodo].join(' | ')).join('\n'))}</textarea></div>
  <div class="campo"><label>Formação — uma por linha: Instituição | Curso | Período</label>
    <textarea id="c-form">${esc((c.formacao || []).map((f) => [f.instituicao, f.curso, f.periodo].join(' | ')).join('\n'))}</textarea></div>
  <div class="campo"><label>Fonte dos dados (importante para LGPD)</label>
    <input id="c-fonte" value="${esc(c.fonte || 'perfil público do LinkedIn')}"></div>
  <div class="linha">
    <button class="btn" data-acao="salvarCandidato" data-cid="${c.id || ''}" data-assign="${c._assignmentDestino || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
  </div>`;
}

function listaDeLinhas(valor, campos) {
  return valor.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split('|').map((s) => s.trim());
    const o = {};
    campos.forEach((k, i) => { o[k] = p[i] || ''; });
    return o;
  });
}

acoes.novoCandidatoManual = (el, d) => {
  abrirModal('Novo profissional', formCandidato({ _assignmentDestino: (d && d.id) || '' }));
};
acoes.editarCandidato = (el, d) => abrirModal('Editar profissional', formCandidato(acharCandidato(d.cid)));

acoes.salvarCandidato = (el, d) => {
  const nome = $('#c-nome').value.trim();
  if (!nome) { aviso('O nome é obrigatório.'); return; }
  let c = d.cid ? acharCandidato(d.cid) : null;
  const novo = !c;
  if (novo) { c = { id: uid(), criadoEm: hoje(), notas: [] }; base.candidatos.push(c); }
  c.nome = nome;
  c.headline = $('#c-headline').value.trim();
  c.cargoAtual = $('#c-cargo').value.trim();
  c.empresaAtual = $('#c-empresa').value.trim();
  c.localizacao = $('#c-local').value.trim();
  c.senioridade = $('#c-senioridade').value;
  c.email = $('#c-email').value.trim();
  c.telefone = $('#c-telefone').value.trim();
  c.linkedinUrl = $('#c-linkedin').value.trim();
  c.disponibilidade = $('#c-disponibilidade').value.trim();
  c.remuneracao = { atual: $('#c-remun').value.trim(), pretendida: $('#c-pretensao').value.trim() };
  c.resumo = $('#c-resumo').value;
  c.competencias = $('#c-competencias').value.split(',').map((s) => s.trim()).filter(Boolean);
  c.idiomas = $('#c-idiomas').value.split(',').map((s) => s.trim()).filter(Boolean);
  c.tags = $('#c-tags').value.split(',').map((s) => s.trim()).filter(Boolean);
  // O formulário mostra só Cargo|Empresa|Período; local e descrição já
  // importados continuam guardados quando a linha não muda.
  c.experiencias = listaDeLinhas($('#c-exp').value, ['cargo', 'empresa', 'periodo'])
    .map((e, i) => {
      const antiga = (c.experiencias || [])[i];
      return antiga && antiga.cargo === e.cargo && antiga.empresa === e.empresa
        ? Object.assign({}, antiga, e) : e;
    });
  c.formacao = listaDeLinhas($('#c-form').value, ['instituicao', 'curso', 'periodo']);
  c.fonte = $('#c-fonte').value.trim();
  c.atualizadoEm = hoje();
  registrarAtividade('candidato', `${novo ? 'Perfil cadastrado' : 'Perfil atualizado'}: ${c.nome}`, { candidatoId: c.id });
  salvar();
  fecharModal();
  if (d.assign) { acoes.vincularCandidato(null, { id: d.assign, cid: c.id }); return; }
  if (novo) ir('#/candidato/' + c.id); else render();
};

acoes.excluirCandidato = (el, d) => {
  const c = acharCandidato(d.cid);
  if (!confirm(`Excluir definitivamente os dados de ${c.nome}? (direito de eliminação — LGPD art. 18)`)) return;
  base.candidatos = base.candidatos.filter((x) => x.id !== c.id);
  base.assignments.forEach((a) => { a.candidatos = (a.candidatos || []).filter((v) => v.candidatoId !== c.id); });
  registrarAtividade('lgpd', `Dados de ${c.nome} eliminados`);
  salvar(); ir('#/candidatos'); render();
};

acoes.registrarConsentimento = (el, d) => {
  const c = acharCandidato(d.cid);
  const html = `
    <div class="campo"><label>Situação</label><select id="k-status">
      <option value="concedido">Consentimento concedido pelo titular</option>
      <option value="negado">Titular recusou / pediu remoção</option>
      <option value="pendente">Pendente</option></select></div>
    <div class="campo"><label>Base legal</label><select id="k-base">
      <option>consentimento do titular (art. 7º, I — LGPD)</option>
      <option>legítimo interesse do controlador (art. 7º, IX — LGPD)</option>
      <option>execução de contrato / procedimentos preliminares (art. 7º, V — LGPD)</option></select></div>
    <div class="campo"><label>Como foi obtido</label>
      <input id="k-origem" placeholder="Ex.: e-mail de 12/03, WhatsApp, portal de atualização"></div>
    <div class="campo"><label>Observação</label><textarea id="k-obs"></textarea></div>
    <div class="linha"><button class="btn" data-acao="salvarConsentimento" data-cid="${c.id}">Salvar</button>
      <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button></div>`;
  abrirModal('Registro de consentimento (LGPD)', html);
};

acoes.salvarConsentimento = (el, d) => {
  const c = acharCandidato(d.cid);
  c.consentimento = {
    status: $('#k-status').value,
    base: $('#k-base').value,
    origem: $('#k-origem').value.trim(),
    observacao: $('#k-obs').value.trim(),
    data: hoje()
  };
  registrarAtividade('lgpd', `Consentimento (${c.consentimento.status}) registrado para ${c.nome}`, { candidatoId: c.id });
  salvar(); fecharModal(); render();
};

/* ---------------------------- importação do LinkedIn ---------------------------- */

function telaImportacao(assignmentId, candidatoId) {
  const c = candidatoId ? acharCandidato(candidatoId) : null;
  return `
  <p class="subtexto">Abra o perfil no LinkedIn, selecione a página inteira (<strong>Ctrl/Cmd + A</strong>),
  copie (<strong>Ctrl/Cmd + C</strong>) e cole abaixo. Também funciona com o texto do PDF que o LinkedIn
  gera em <em>Mais → Salvar em PDF</em>, ou com um currículo colado.</p>
  ${c ? `<p class="subtexto">Atualizando o perfil de <strong>${esc(c.nome)}</strong> — você revisa antes de gravar.</p>` : ''}
  <div class="campo"><textarea id="li-texto" style="min-height:220px" placeholder="Cole aqui o perfil copiado…"></textarea></div>
  <div class="linha">
    <button class="btn" data-acao="processarLinkedIn" data-assign="${assignmentId || ''}" data-cid="${candidatoId || ''}">Ler perfil</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
  </div>
  <p class="subtexto" style="margin-top:14px">
    <strong>Sobre o LGPD e a sincronização automática:</strong> o LinkedIn não permite raspagem
    automática de perfis e não oferece API pública para isso — sincronizar sozinho, sem o profissional
    saber, além de violar os termos da plataforma, é difícil de sustentar como tratamento legítimo de
    dados. O caminho seguro é este: importação assistida pelo consultor + <em>link de atualização</em>
    enviado ao profissional, no qual ele confirma os dados e o consentimento.</p>`;
}

acoes.novoCandidatoLinkedIn = (el, d) => abrirModal('Importar perfil do LinkedIn', telaImportacao((d && d.id) || '', ''));
acoes.atualizarPeloLinkedIn = (el, d) => abrirModal('Atualizar pelo LinkedIn', telaImportacao('', d.cid));

acoes.processarLinkedIn = (el, d) => {
  const texto = $('#li-texto').value;
  if (!texto.trim()) { aviso('Cole o texto do perfil primeiro.'); return; }
  const p = importarLinkedIn(texto);
  const antigo = d.cid ? acharCandidato(d.cid) : null;
  const mesclado = Object.assign({}, antigo || {}, {
    nome: p.nome || (antigo && antigo.nome) || '',
    headline: p.headline || (antigo && antigo.headline) || '',
    cargoAtual: p.cargoAtual || (antigo && antigo.cargoAtual) || '',
    empresaAtual: p.empresaAtual || (antigo && antigo.empresaAtual) || '',
    localizacao: p.localizacao || (antigo && antigo.localizacao) || '',
    linkedinUrl: p.linkedinUrl || (antigo && antigo.linkedinUrl) || '',
    email: p.email || (antigo && antigo.email) || '',
    telefone: p.telefone || (antigo && antigo.telefone) || '',
    resumo: p.resumo || (antigo && antigo.resumo) || '',
    experiencias: p.experiencias.length ? p.experiencias : (antigo && antigo.experiencias) || [],
    formacao: p.formacao.length ? p.formacao : (antigo && antigo.formacao) || [],
    competencias: p.competencias.length ? p.competencias : (antigo && antigo.competencias) || [],
    idiomas: p.idiomas.length ? p.idiomas : (antigo && antigo.idiomas) || [],
    fonte: 'perfil público do LinkedIn (importado em ' + fmtData(hoje()) + ')',
    _assignmentDestino: d.assign || ''
  });

  const achados = [
    p.nome && 'nome', p.headline && 'headline', p.localizacao && 'localização',
    p.experiencias.length && `${p.experiencias.length} experiência(s)`,
    p.formacao.length && `${p.formacao.length} formação(ões)`,
    p.competencias.length && `${p.competencias.length} competência(s)`,
    p.linkedinUrl && 'URL do perfil'
  ].filter(Boolean).join(', ');

  abrirModal('Revisar antes de gravar',
    `<div class="cartao" style="margin-bottom:12px"><strong>Li do texto colado:</strong> ${esc(achados || 'pouca coisa — confira e complete abaixo')}.
     <div class="subtexto">Corrija o que veio torto: o LinkedIn muda o layout com frequência, então a leitura é sempre uma ajuda, não uma verdade absoluta.</div></div>`
    + formCandidato(mesclado));
};

/* ---- link de atualização (portal do candidato) ---- */

acoes.linkAtualizacao = (el, d) => {
  const c = acharCandidato(d.cid);
  if (modoLocal) {
    abrirModal('Link de atualização', `<p>O link de atualização precisa do servidor rodando
      (<code>node server.js</code>), porque é o servidor que recebe a resposta do profissional.</p>
      <div class="linha"><button class="btn btn-fantasma" data-acao="fecharModal">Fechar</button></div>`);
    return;
  }
  if (!c.tokenPortal) { c.tokenPortal = uid().replace(/-/g, ''); salvar(); }
  const url = location.origin + '/portal/' + c.tokenPortal;
  const texto = `Olá, ${c.nome.split(' ')[0]}! Estamos com uma posição que pode fazer sentido para o seu momento. ` +
    `Para eu trabalhar com dados corretos e com o seu consentimento, dá uma olhada e confirma seu perfil aqui: ${url}`;
  abrirModal('Link de atualização do profissional', `
    <p class="subtexto">Envie este link ao profissional. Ele revisa os próprios dados, autoriza o uso
    (registro de consentimento LGPD) e pode pedir a exclusão. O que ele enviar entra direto no sistema.</p>
    <div class="campo"><label>Link</label><input id="p-url" value="${esc(url)}" readonly></div>
    <div class="campo"><label>Mensagem sugerida</label><textarea id="p-msg" style="min-height:80px">${esc(texto)}</textarea></div>
    <div class="linha">
      <button class="btn" data-acao="copiarLink">Copiar link</button>
      <button class="btn btn-sec" data-acao="copiarMensagem">Copiar mensagem</button>
      <button class="btn btn-fantasma" data-acao="fecharModal">Fechar</button>
    </div>
    <p class="subtexto" style="margin-top:10px">Vale só para quem tem o link. Para invalidá-lo, gere um novo.</p>`);
};

function copiar(valor) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(valor).then(() => aviso('Copiado.'), () => aviso('Copie manualmente.'));
  } else { aviso('Copie manualmente.'); }
}
acoes.copiarLink = () => copiar($('#p-url').value);
acoes.copiarMensagem = () => copiar($('#p-msg').value);

/* ---------------------------- clientes ---------------------------- */

function telaClientes() {
  const linhas = base.clientes.map((c) => {
    const abertos = base.assignments.filter((a) => a.clienteId === c.id && a.status === 'Aberto').length;
    const todos = base.assignments.filter((a) => a.clienteId === c.id).length;
    return `<tr class="clicavel" data-acao="editarCliente" data-id="${c.id}">
      <td><strong>${esc(c.nome)}</strong><div class="subtexto">${esc(c.setor || '')}</div></td>
      <td>${esc(c.contatoNome || '—')}<div class="subtexto">${esc(c.contatoEmail || '')}</div></td>
      <td>${abertos} aberto(s) / ${todos} no total</td>
    </tr>`;
  }).join('');
  return `
  <div class="linha" style="margin-bottom:14px">
    <h1>Clientes</h1><div class="espaco"></div>
    <button class="btn" data-acao="novoCliente">+ Novo cliente</button>
  </div>
  <div class="cartao">
    ${base.clientes.length ? `<table><thead><tr><th>Empresa</th><th>Contato</th><th>Assignments</th></tr></thead><tbody>${linhas}</tbody></table>`
      : '<div class="vazio">Nenhum cliente cadastrado.</div>'}
  </div>`;
}

function formCliente(c) {
  c = c || {};
  return `
  <div class="grade g2">
    <div class="campo"><label>Empresa *</label><input id="cl-nome" value="${esc(c.nome || '')}"></div>
    <div class="campo"><label>Setor</label><input id="cl-setor" value="${esc(c.setor || '')}"></div>
    <div class="campo"><label>Contato</label><input id="cl-contato" value="${esc(c.contatoNome || '')}"></div>
    <div class="campo"><label>E-mail do contato</label><input id="cl-email" value="${esc(c.contatoEmail || '')}"></div>
  </div>
  <div class="campo"><label>Observações</label><textarea id="cl-obs">${esc(c.obs || '')}</textarea></div>
  <div class="linha">
    <button class="btn" data-acao="salvarCliente" data-id="${c.id || ''}">Salvar</button>
    <button class="btn btn-fantasma" data-acao="fecharModal">Cancelar</button>
    ${c.id ? `<button class="btn btn-perigo espaco" data-acao="excluirCliente" data-id="${c.id}">Excluir</button>` : ''}
  </div>`;
}

acoes.novoCliente = () => abrirModal('Novo cliente', formCliente(null));
acoes.editarCliente = (el, d) => abrirModal('Editar cliente', formCliente(acharCliente(d.id)));
acoes.salvarCliente = (el, d) => {
  const nome = $('#cl-nome').value.trim();
  if (!nome) { aviso('Informe o nome da empresa.'); return; }
  let c = d.id ? acharCliente(d.id) : null;
  if (!c) { c = { id: uid(), criadoEm: hoje() }; base.clientes.push(c); }
  c.nome = nome;
  c.setor = $('#cl-setor').value.trim();
  c.contatoNome = $('#cl-contato').value.trim();
  c.contatoEmail = $('#cl-email').value.trim();
  c.obs = $('#cl-obs').value;
  salvar(); fecharModal(); render();
};
acoes.excluirCliente = (el, d) => {
  if (base.assignments.some((a) => a.clienteId === d.id)) { aviso('Há assignments ligados a este cliente.'); return; }
  if (!confirm('Excluir cliente?')) return;
  base.clientes = base.clientes.filter((c) => c.id !== d.id);
  salvar(); fecharModal(); render();
};

/* ---------------------------- relatórios ---------------------------- */

function telaRelatorios() {
  return `
  <h1>Relatórios</h1>
  <div class="grade g2">
    <div class="cartao">
      <h3>Progresso do assignment</h3>
      <p class="subtexto">Status do funil, conversão entre etapas, tempo médio e o que aconteceu desde a última conversa com o cliente.</p>
      ${base.assignments.length ? `<table><tbody>${base.assignments.map((a) =>
        `<tr class="clicavel" data-acao="verRelatorioAssignment" data-id="${a.id}">
          <td><strong>${esc(a.titulo)}</strong><div class="subtexto">${esc(nomeCliente(a.clienteId))}</div></td>
          <td style="text-align:right"><span class="tag tag-azul">abrir</span></td></tr>`).join('')}</tbody></table>`
        : '<div class="subtexto">Nenhum assignment ainda.</div>'}
    </div>
    <div class="cartao">
      <h3>Relatório do candidato</h3>
      <p class="subtexto">Perfil completo, histórico nos processos e pareceres — para enviar ao cliente ou arquivar.</p>
      <div class="campo"><input id="rel-busca-cand" placeholder="Buscar profissional…"></div>
      <div id="rel-lista"></div>
    </div>
  </div>
  <div class="cartao">
    <h3>Exportações</h3>
    <div class="linha">
      <button class="btn btn-sec" data-acao="exportarCandidatosCSV">Candidatos (CSV)</button>
      <button class="btn btn-sec" data-acao="exportarPipelineCSV">Pipeline completo (CSV)</button>
      <button class="btn btn-sec" data-acao="exportarBackup">Backup completo (JSON)</button>
    </div>
    <p class="subtexto" style="margin-top:8px">Os CSVs abrem direto no Excel (separador ponto e vírgula).</p>
  </div>`;
}

function ligarBuscaRelatorio() {
  const campo = $('#rel-busca-cand');
  if (!campo) return;
  const pinta = () => {
    const q = campo.value.trim().toLowerCase();
    const achados = base.candidatos
      .filter((c) => !q || textoDoCandidato(c).includes(q))
      .slice(0, 25);
    $('#rel-lista').innerHTML = achados.length ? `<table><tbody>${achados.map((c) =>
      `<tr class="clicavel" data-acao="verRelatorioCandidato" data-cid="${c.id}">
        <td><strong>${esc(c.nome)}</strong><div class="subtexto">${esc(c.cargoAtual || '')}</div></td>
        <td style="text-align:right"><span class="tag tag-azul">abrir</span></td></tr>`).join('')}</tbody></table>`
      : '<div class="subtexto">Nada encontrado.</div>';
    ligarAcoes($('#rel-lista'));
  };
  campo.addEventListener('input', pinta);
  pinta();
}

function tempoMedioPorEtapa(a) {
  const soma = {}; const qtd = {};
  (a.candidatos || []).forEach((v) => {
    const h = (v.historico || []).slice().sort((x, y) => new Date(x.data) - new Date(y.data));
    h.forEach((entrada, i) => {
      const fim = h[i + 1] ? new Date(h[i + 1].data) : new Date();
      const dias = Math.max(0, Math.round((fim - new Date(entrada.data)) / 86400000));
      soma[entrada.etapa] = (soma[entrada.etapa] || 0) + dias;
      qtd[entrada.etapa] = (qtd[entrada.etapa] || 0) + 1;
    });
  });
  const media = {};
  Object.keys(soma).forEach((e) => { media[e] = Math.round(soma[e] / qtd[e]); });
  return media;
}

function passaramPor(a, etapa) {
  return (a.candidatos || []).filter((v) =>
    v.etapa === etapa || (v.historico || []).some((h) => h.etapa === etapa)).length;
}

function relatorioAssignment(id) {
  const a = acharAssignment(id);
  if (!a) return '<div class="vazio">Assignment não encontrado.</div>';
  const etapas = etapasDe(a);
  const medias = tempoMedioPorEtapa(a);
  const total = (a.candidatos || []).length;

  const linhasFunil = etapas.map((e, i) => {
    const passaram = passaramPor(a, e);
    const agora = (a.candidatos || []).filter((v) => v.etapa === e).length;
    const anterior = i === 0 ? total : passaramPor(a, etapas[i - 1]);
    const conv = i > 0 && anterior ? Math.round((passaram / anterior) * 100) + '%' : '—';
    const doTotal = total ? Math.round((passaram / total) * 100) + '%' : '—';
    return `<tr><td>${esc(e)}</td><td>${passaram}</td><td>${agora}</td>
      <td>${conv}</td><td>${doTotal}</td><td>${medias[e] != null ? medias[e] + ' d' : '—'}</td></tr>`;
  }).join('');

  const emProcesso = (a.candidatos || [])
    .filter((v) => ['Ativo', 'Contratado'].includes(v.situacao || 'Ativo'))
    .sort((x, y) => etapas.indexOf(y.etapa) - etapas.indexOf(x.etapa));

  const linhasCand = emProcesso.map((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    return `<tr>
      <td><strong>${esc(c.nome || '—')}</strong><div class="subtexto">${esc(c.cargoAtual || '')}${c.empresaAtual ? ' — ' + esc(c.empresaAtual) : ''}</div></td>
      <td>${esc(v.etapa)}</td>
      <td>${v.fit ? esc(v.fit) + '/5' : '—'}</td>
      <td>${diasDesde(v.etapaDesde || v.entrouEm)} d</td>
      <td class="subtexto">${esc((v.parecer || '').slice(0, 220))}</td></tr>`;
  }).join('');

  const fora = (a.candidatos || []).filter((v) => ['Declinou', 'Descartado', 'Stand-by'].includes(v.situacao));
  const linhasFora = fora.map((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    return `<tr><td>${esc(c.nome || '—')}</td><td>${esc(v.situacao)}</td><td class="subtexto">${esc(v.motivo || '')}</td></tr>`;
  }).join('');

  const movs = (base.atividades || []).filter((at) => at.assignmentId === a.id).slice(0, 15)
    .map((at) => `<li>${esc(at.texto)} <span class="q">— ${fmtData(at.data)}</span></li>`).join('');

  return `
  <div class="linha nao-imprime" style="margin-bottom:12px">
    <button class="btn btn-fantasma" data-acao="voltarAssignment" data-id="${a.id}">← Voltar</button>
    <div class="espaco"></div>
    <button class="btn" data-acao="imprimir">Imprimir / PDF</button>
    <button class="btn btn-sec" data-acao="copiarRelatorio">Copiar como texto</button>
    <button class="btn btn-sec" data-acao="exportarAssignmentCSV" data-id="${a.id}">CSV</button>
  </div>
  <div class="relatorio" id="area-relatorio">
    <h1>Relatório de progresso — ${esc(a.titulo)}</h1>
    <p class="subtexto">${esc(nomeCliente(a.clienteId))}${a.localizacao ? ' · ' + esc(a.localizacao) : ''}
      ${a.consultor ? ' · Consultor: ' + esc(a.consultor) : ''}<br>
      Aberto em ${fmtData(a.abertoEm)} (${diasDesde(a.abertoEm)} dias) ·
      Status: ${esc(a.status)}${a.prazoAlvo ? ' · Prazo alvo: ' + fmtData(a.prazoAlvo) : ''}<br>
      Emitido em ${fmtData(hoje())}</p>

    <h2>Resumo</h2>
    <table><tbody>
      <tr><th>Profissionais mapeados</th><td>${total}</td></tr>
      <tr><th>Em processo ativo</th><td>${(a.candidatos || []).filter((v) => (v.situacao || 'Ativo') === 'Ativo').length}</td></tr>
      <tr><th>Na short list</th><td>${passaramPor(a, 'Short list')}</td></tr>
      <tr><th>Fora do processo</th><td>${fora.length}</td></tr>
      <tr><th>Contratados</th><td>${(a.candidatos || []).filter((v) => v.situacao === 'Contratado').length}</td></tr>
    </tbody></table>

    <h2>Funil</h2>
    <table><thead><tr><th>Etapa</th><th>Passaram</th><th>Estão agora</th><th>Conversão da anterior</th><th>% do total</th><th>Tempo médio</th></tr></thead>
      <tbody>${linhasFunil}</tbody></table>

    <h2>Candidatos em processo</h2>
    ${linhasCand ? `<table><thead><tr><th>Profissional</th><th>Etapa</th><th>Fit</th><th>Na etapa há</th><th>Parecer</th></tr></thead><tbody>${linhasCand}</tbody></table>`
      : '<p class="subtexto">Nenhum candidato ativo.</p>'}

    ${linhasFora ? `<h2>Saíram do processo</h2><table><thead><tr><th>Profissional</th><th>Situação</th><th>Motivo</th></tr></thead><tbody>${linhasFora}</tbody></table>` : ''}

    ${movs ? `<h2>Movimentações recentes</h2><ul>${movs}</ul>` : ''}

    ${a.descricao ? `<h2>Posição</h2><p class="subtexto">${nl2br(a.descricao)}</p>` : ''}
  </div>`;
}

function relatorioCandidato(id) {
  const c = acharCandidato(id);
  if (!c) return '<div class="vazio">Profissional não encontrado.</div>';
  const procs = processosDoCandidato(c.id);

  const exp = (c.experiencias || []).map((e) =>
    `<li><strong>${esc(e.cargo || '')}</strong>${e.empresa ? ' — ' + esc(e.empresa) : ''}
      <div class="subtexto">${esc(e.periodo || '')}</div>
      ${e.descricao ? `<div class="subtexto">${nl2br(e.descricao)}</div>` : ''}</li>`).join('');
  const form = (c.formacao || []).map((f) =>
    `<li><strong>${esc(f.instituicao || '')}</strong> — ${esc(f.curso || '')} <span class="subtexto">${esc(f.periodo || '')}</span></li>`).join('');

  const historico = procs.map((p) => {
    const h = (p.vinculo.historico || []).map((x) => `${esc(x.etapa)} (${fmtData(x.data)})`).join(' → ');
    return `<tr><td><strong>${esc(p.assignment.titulo)}</strong><div class="subtexto">${esc(nomeCliente(p.assignment.clienteId))}</div></td>
      <td>${esc(p.vinculo.etapa)} · ${esc(p.vinculo.situacao || 'Ativo')}</td>
      <td class="subtexto">${h}</td></tr>`;
  }).join('');

  const pareceres = procs.filter((p) => p.vinculo.parecer).map((p) =>
    `<li><strong>${esc(p.assignment.titulo)}</strong><div class="subtexto">${nl2br(p.vinculo.parecer)}</div></li>`).join('');
  const notas = (c.notas || []).slice().reverse().map((n) =>
    `<li>${nl2br(n.texto)} <span class="subtexto">— ${fmtData(n.data)}</span></li>`).join('');

  return `
  <div class="linha nao-imprime" style="margin-bottom:12px">
    <button class="btn btn-fantasma" data-acao="abrirCandidato" data-cid="${c.id}">← Voltar</button>
    <div class="espaco"></div>
    <button class="btn" data-acao="imprimir">Imprimir / PDF</button>
    <button class="btn btn-sec" data-acao="copiarRelatorio">Copiar como texto</button>
  </div>
  <div class="relatorio" id="area-relatorio">
    <h1>${esc(c.nome)}</h1>
    <p class="subtexto">${esc(c.cargoAtual || '')}${c.empresaAtual ? ' — ' + esc(c.empresaAtual) : ''}
      ${c.localizacao ? '<br>' + esc(c.localizacao) : ''}
      ${c.linkedinUrl ? '<br>' + esc(c.linkedinUrl) : ''}<br>
      Emitido em ${fmtData(hoje())} · Dados atualizados em ${fmtData(c.atualizadoEm || c.criadoEm)}</p>

    ${c.resumo ? `<h2>Resumo</h2><p>${nl2br(c.resumo)}</p>` : ''}
    ${exp ? `<h2>Experiência</h2><ul>${exp}</ul>` : ''}
    ${form ? `<h2>Formação</h2><ul>${form}</ul>` : ''}
    ${(c.competencias || []).length ? `<h2>Competências</h2><p>${esc(c.competencias.join(' · '))}</p>` : ''}
    ${(c.idiomas || []).length ? `<h2>Idiomas</h2><p>${esc(c.idiomas.join(' · '))}</p>` : ''}

    <h2>Remuneração e disponibilidade</h2>
    <table><tbody>
      <tr><th>Atual</th><td>${esc((c.remuneracao || {}).atual || '—')}</td></tr>
      <tr><th>Pretensão</th><td>${esc((c.remuneracao || {}).pretendida || '—')}</td></tr>
      <tr><th>Disponibilidade</th><td>${esc(c.disponibilidade || '—')}</td></tr>
    </tbody></table>

    ${historico ? `<h2>Processos</h2><table><thead><tr><th>Assignment</th><th>Situação</th><th>Trajetória</th></tr></thead><tbody>${historico}</tbody></table>` : ''}
    ${pareceres ? `<h2>Pareceres do consultor</h2><ul>${pareceres}</ul>` : ''}
    ${notas ? `<h2>Anotações</h2><ul>${notas}</ul>` : ''}

    <h2>Origem dos dados (LGPD)</h2>
    <p class="subtexto">Fonte: ${esc(c.fonte || 'não informada')}.
      Consentimento: ${esc((c.consentimento || {}).status || 'não registrado')}
      ${(c.consentimento || {}).data ? ' em ' + fmtData(c.consentimento.data) : ''}.
      ${(c.consentimento || {}).base ? 'Base legal: ' + esc(c.consentimento.base) + '.' : ''}</p>
  </div>`;
}

acoes.voltarAssignment = (el, d) => ir('#/assignment/' + d.id);
acoes.imprimir = () => window.print();
acoes.copiarRelatorio = () => {
  const area = $('#area-relatorio');
  const texto = area.innerText.replace(/\n{3,}/g, '\n\n');
  copiar(texto);
};

/* ---------------------------- exportações ---------------------------- */

acoes.exportarCandidatosCSV = () => {
  const linhas = [['Nome', 'Headline', 'Cargo atual', 'Empresa atual', 'Local', 'Senioridade',
    'E-mail', 'Telefone', 'LinkedIn', 'Competências', 'Consentimento', 'Fonte', 'Atualizado em']];
  base.candidatos.forEach((c) => linhas.push([c.nome, c.headline, c.cargoAtual, c.empresaAtual,
    c.localizacao, c.senioridade, c.email, c.telefone, c.linkedinUrl,
    (c.competencias || []).join(', '), (c.consentimento || {}).status || 'pendente', c.fonte,
    fmtData(c.atualizadoEm || c.criadoEm)]));
  baixar('candidatos.csv', '﻿' + csv(linhas), 'text/csv');
};

acoes.exportarPipelineCSV = () => {
  const linhas = [['Assignment', 'Cliente', 'Status assignment', 'Profissional', 'Etapa', 'Situação',
    'Fit', 'Dias na etapa', 'Entrou em', 'Motivo', 'Parecer']];
  base.assignments.forEach((a) => (a.candidatos || []).forEach((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    linhas.push([a.titulo, nomeCliente(a.clienteId), a.status, c.nome, v.etapa, v.situacao || 'Ativo',
      v.fit || '', diasDesde(v.etapaDesde || v.entrouEm), fmtData(v.entrouEm), v.motivo || '', v.parecer || '']);
  }));
  baixar('pipeline.csv', '﻿' + csv(linhas), 'text/csv');
};

acoes.exportarAssignmentCSV = (el, d) => {
  const a = acharAssignment(d.id);
  const linhas = [['Profissional', 'Empresa atual', 'Etapa', 'Situação', 'Fit', 'Dias na etapa', 'Parecer']];
  (a.candidatos || []).forEach((v) => {
    const c = acharCandidato(v.candidatoId) || {};
    linhas.push([c.nome, c.empresaAtual, v.etapa, v.situacao || 'Ativo', v.fit || '',
      diasDesde(v.etapaDesde || v.entrouEm), v.parecer || '']);
  });
  baixar(`pipeline-${(a.titulo || 'assignment').replace(/[^\w]+/g, '-').toLowerCase()}.csv`,
    '﻿' + csv(linhas), 'text/csv');
};

acoes.exportarBackup = () => {
  baixar(`backup-recrutamento-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(base, null, 2), 'application/json');
};

/* ---------------------------- backup / restauração / exemplo ---------------------------- */

acoes.abrirBackup = () => {
  abrirModal('Backup e dados', `
    <p class="subtexto">${modoLocal
      ? 'Você está no <strong>modo navegador</strong>: os dados ficam salvos apenas neste computador/navegador. Exporte com frequência.'
      : 'Os dados ficam em <code>dados/base.json</code>, na pasta do projeto. O servidor guarda uma cópia diária em <code>dados/backups/</code>.'}</p>
    <div class="linha" style="margin-bottom:14px">
      <button class="btn" data-acao="exportarBackup">Exportar tudo (JSON)</button>
      <button class="btn btn-sec" data-acao="exportarCandidatosCSV">Candidatos (CSV)</button>
      <button class="btn btn-sec" data-acao="exportarPipelineCSV">Pipeline (CSV)</button>
    </div>
    <div class="campo"><label>Restaurar de um arquivo JSON (substitui tudo)</label>
      <input type="file" id="b-arquivo" accept="application/json"></div>
    <div class="linha"><button class="btn btn-sec" data-acao="restaurarBackup">Restaurar</button></div>
    <hr style="border:0;border-top:1px solid var(--borda);margin:16px 0">
    <div class="linha">
      <button class="btn btn-fantasma" data-acao="carregarExemplo">Carregar dados de exemplo</button>
      <span class="subtexto">Cria um cliente, um assignment e três profissionais fictícios para você ver o sistema funcionando.</span>
    </div>`);
};

acoes.restaurarBackup = () => {
  const arq = $('#b-arquivo').files[0];
  if (!arq) { aviso('Escolha um arquivo.'); return; }
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dados = JSON.parse(leitor.result);
      if (!dados || !Array.isArray(dados.candidatos)) throw new Error('formato inesperado');
      if (!confirm('Isso substitui todos os dados atuais. Continuar?')) return;
      base = Object.assign(baseVazia(), dados, { versao: base.versao });
      salvar(); fecharModal(); render();
      aviso('Backup restaurado.');
    } catch (e) { aviso('Arquivo inválido.'); }
  };
  leitor.readAsText(arq);
};

acoes.carregarExemplo = () => {
  if (base.candidatos.length || base.assignments.length) {
    if (!confirm('Já existem dados. Adicionar o exemplo mesmo assim?')) return;
  }
  const cliente = { id: uid(), nome: 'Aurora Alimentos', setor: 'Bens de consumo', contatoNome: 'Marina Prado', contatoEmail: 'marina@exemplo.com', criadoEm: hoje() };
  base.clientes.push(cliente);

  const modelos = [
    { nome: 'Camila Duarte', cargoAtual: 'Diretora Comercial', empresaAtual: 'Vitalis Foods', localizacao: 'São Paulo, SP', senioridade: 'Diretoria', competencias: ['Go-to-market', 'Trade marketing', 'Gestão de P&L'], etapa: 'Entrevista cliente', fit: '5' },
    { nome: 'Rogério Menezes', cargoAtual: 'Head de Vendas LATAM', empresaAtual: 'Nordeste Bebidas', localizacao: 'Recife, PE', senioridade: 'Gerência', competencias: ['Canal indireto', 'KAM', 'Expansão'], etapa: 'Entrevista consultor', fit: '4' },
    { nome: 'Ana Beatriz Lopes', cargoAtual: 'Gerente Nacional de Contas', empresaAtual: 'Grupo Serrano', localizacao: 'Curitiba, PR', senioridade: 'Gerência', competencias: ['Key accounts', 'Negociação', 'Varejo alimentar'], etapa: 'Mapeado', fit: '3' }
  ];

  const assignment = {
    id: uid(), titulo: 'Diretor(a) Comercial Brasil', clienteId: cliente.id,
    cargo: 'Diretor Comercial', localizacao: 'São Paulo, SP', senioridade: 'Diretoria',
    consultor: 'Isa', status: 'Aberto', abertoEm: new Date(Date.now() - 32 * 86400000).toISOString(),
    faixaSalarial: 'R$ 45–60k + bônus', descricao: 'Posição criada para liderar a expansão do canal indireto no Brasil, reportando ao CEO.',
    etapas: ETAPAS_PADRAO.slice(), candidatos: [], criadoEm: hoje()
  };

  modelos.forEach((m, i) => {
    const c = {
      id: uid(), nome: m.nome, headline: m.cargoAtual + ' na ' + m.empresaAtual,
      cargoAtual: m.cargoAtual, empresaAtual: m.empresaAtual, localizacao: m.localizacao,
      senioridade: m.senioridade, competencias: m.competencias, idiomas: ['Português', 'Inglês'],
      experiencias: [{ cargo: m.cargoAtual, empresa: m.empresaAtual, periodo: '2021 - o momento' }],
      formacao: [{ instituicao: 'Universidade Exemplo', curso: 'Administração', periodo: '2005 - 2009' }],
      fonte: 'dado de exemplo', criadoEm: hoje(), atualizadoEm: hoje(), notas: [],
      consentimento: i === 0 ? { status: 'concedido', data: hoje(), base: 'consentimento do titular (art. 7º, I — LGPD)', origem: 'e-mail' } : null
    };
    base.candidatos.push(c);
    const entrou = new Date(Date.now() - (25 - i * 7) * 86400000).toISOString();
    assignment.candidatos.push({
      candidatoId: c.id, etapa: m.etapa, situacao: 'Ativo', fit: m.fit,
      entrouEm: entrou, etapaDesde: new Date(Date.now() - (12 - i * 4) * 86400000).toISOString(),
      historico: [{ etapa: 'Mapeado', data: entrou }].concat(
        m.etapa !== 'Mapeado' ? [{ etapa: m.etapa, de: 'Mapeado', data: new Date(Date.now() - (12 - i * 4) * 86400000).toISOString() }] : []),
      notas: [], parecer: i === 0 ? 'Aderência forte ao desafio de canal indireto; disponível para mudança.' : ''
    });
  });

  base.assignments.push(assignment);
  registrarAtividade('sistema', 'Dados de exemplo carregados');
  salvar(); fecharModal(); ir('#/assignment/' + assignment.id); render();
};

/* ---------------------------- inicialização ---------------------------- */

window.addEventListener('hashchange', render);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });

document.addEventListener('DOMContentLoaded', () => {
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
  $('#btn-backup').addEventListener('click', () => acoes.abrirBackup());
  carregar().then(render);
});
