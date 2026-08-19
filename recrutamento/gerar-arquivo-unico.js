#!/usr/bin/env node
/**
 * Gera recrutamento.html: o sistema inteiro num arquivo só (HTML + CSS + JS
 * embutidos), para abrir com dois cliques, sem Terminal e sem servidor.
 *
 *   node recrutamento/gerar-arquivo-unico.js
 */
const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const publico = path.join(raiz, 'public');

const html = fs.readFileSync(path.join(publico, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publico, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(publico, 'app.js'), 'utf8');

// Atenção: a substituição vai por função. Com string, o JS interpretaria as
// sequências $&, $' e $` que aparecem no próprio código embutido.
const saida = html
  .replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '\n</style>')
  .replace('<script src="app.js"></script>', () => '<script>\n' + js + '\n<\/script>')
  .replace('<title>Sistema de Recrutamento</title>', () =>
    '<title>Sistema de Recrutamento</title>\n<!-- Arquivo único gerado por gerar-arquivo-unico.js — edite public/ e rode o gerador de novo. -->');

if (saida.includes('href="style.css"') || saida.includes('src="app.js"')) {
  console.error('Não consegui embutir CSS/JS — o index.html mudou?');
  process.exit(1);
}

const destino = path.join(raiz, 'recrutamento.html');
fs.writeFileSync(destino, saida, 'utf8');
console.log(`Pronto: ${destino} (${Math.round(saida.length / 1024)} KB)`);

// Versão para publicar como página hospedada: sem <html>/<head>/<body>,
// porque o hospedeiro monta esse invólucro.
const corpo = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  .replace('<script src="app.js"></script>', '')
  .trim();

const online = [
  '<title>Sistema de Recrutamento</title>',
  '<style>', css, '</style>',
  corpo,
  '<script>',
  'window.RECRUTAMENTO_ONLINE = true;',
  js,
  '<\/script>'
].join('\n');

const destinoOnline = path.join(raiz, 'recrutamento-online.html');
fs.writeFileSync(destinoOnline, online, 'utf8');
console.log(`Pronto: ${destinoOnline} (${Math.round(online.length / 1024)} KB)`);
