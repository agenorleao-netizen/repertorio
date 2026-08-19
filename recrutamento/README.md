# 🧭 Sistema de Recrutamento (executive search)

Sistema para instrumentalizar processos de recrutamento — na linha do que fazem
**File Finder, Cluen, Invenias e Greenhouse**, mas enxuto, rodando local, sem
mensalidade e sem dependência de nuvem.

Cobre os quatro pontos que a operação pediu:

| Necessidade | Onde está no sistema |
|---|---|
| 1. Puxar o perfil do LinkedIn e preencher automático | **Importar do LinkedIn** (cola o perfil → preenche os campos) + **link de atualização** enviado ao profissional |
| 2. Montar um assignment e gerir as etapas, candidato a candidato | **Assignments** com pipeline arrastável, etapas configuráveis por busca, parecer e histórico por candidato |
| 3. Puxar relatórios de progresso do assignment | **Relatórios → Progresso do assignment** (funil, conversão, tempo por etapa, movimentações) |
| 4. Puxar relatório do candidato | **Relatórios → Relatório do candidato** (perfil, trajetória nos processos, pareceres) |

---

## ✅ Jeito mais fácil (sem instalar nada): `recrutamento.html`

1. Baixe o arquivo **`recrutamento.html`** (é um arquivo só — o sistema inteiro
   está dentro dele)
2. Dê **dois cliques** — abre no navegador (use **Chrome** no Mac)
3. Pronto. Clique em **Backup → Carregar dados de exemplo** para ver funcionando

Não precisa de Node, nem Terminal, nem servidor. Os dados ficam salvos no
próprio navegador, naquele computador. Nesse modo o *link de atualização do
candidato* não funciona (ele depende do servidor para receber a resposta) —
para isso, use a versão com servidor abaixo.

> Exporte de vez em quando em **Backup → Exportar tudo (JSON)**: como os dados
> ficam no navegador, limpar o histórico/cache leva a base junto.

---

## Versão com servidor (recomendada para uso de verdade)

Vale a pena porque os dados ficam num arquivo seu (`dados/base.json`, com backup
diário), o time inteiro acessa pela rede Wi-Fi e o link de atualização do
candidato funciona.

Precisa apenas do **Node.js** (14 ou mais novo). No terminal, dentro da pasta do projeto:

```bash
node recrutamento/server.js
```

Aparece algo assim:

```
  🧭  Sistema de Recrutamento rodando!

  Neste computador:  http://localhost:8090
  Na mesma rede:     http://192.168.0.15:8090
```

Abra o endereço no navegador. Quem estiver na mesma rede Wi-Fi (o time, o
celular) usa o segundo endereço.

Para mudar a porta: `PORT=9000 node recrutamento/server.js`.

**Onde ficam os dados:** em `recrutamento/dados/base.json` — um arquivo JSON
comum, que dá para copiar, versionar ou abrir em qualquer editor. O servidor
guarda uma cópia por dia em `recrutamento/dados/backups/`. Nada sai do seu
computador.

---

## O dia a dia

1. **Clientes** — cadastre a empresa e o contato.
2. **Assignments** — crie a busca (posição, cliente, consultor, prazo, job spec).
   As etapas vêm prontas — Mapeado → Abordado → Entrevista consultor →
   Short list → Entrevista cliente → Proposta → Contratado — e podem ser
   trocadas assignment a assignment.
3. **Candidatos** — importe do LinkedIn ou cadastre manualmente. O banco é
   reaproveitável: o mesmo profissional pode estar em vários processos.
4. **Pipeline** — dentro do assignment, arraste a ficha entre as etapas.
   Clicando na ficha você registra fit (1–5), parecer, situação
   (ativo, declinou, descartado, stand-by, contratado) e anotações datadas.
   O sistema guarda todo o histórico de movimentação e avisa quem está parado
   há 14 dias ou mais.
5. **Relatórios** — imprima em PDF, copie como texto (para colar no e-mail do
   cliente) ou exporte CSV para o Excel.

---

## Sobre puxar o LinkedIn (e o que dá e o que não dá)

Este é o ponto que costuma gerar frustração, então vale ser direto:

**Não existe forma legítima de sincronizar sozinho um perfil do LinkedIn.**
O LinkedIn não oferece API pública de perfis, proíbe raspagem automática nos
termos de uso e bloqueia tecnicamente quem tenta. Sistemas de ATS que "puxam do
LinkedIn" fazem uma destas três coisas:

1. **Extensão de navegador** operada pelo recrutador (o famoso "importar perfil"
   do Invenias/Cluen) — é o recrutador que está vendo o perfil e mandando salvar;
2. **Parceria oficial** — *LinkedIn Recruiter System Connect* / Talent Solutions,
   que exige contrato do LinkedIn Recruiter e certificação do ATS;
3. **Recebimento de currículo** — o candidato exporta ou envia o próprio perfil.

O que este sistema faz, sem depender de contrato nem de extensão:

- **Importar do LinkedIn (assistido):** abra o perfil, selecione a página inteira
  (`Ctrl/Cmd + A`), copie e cole na tela de importação. O sistema separa nome,
  headline, localização, URL, experiências, formação, competências e idiomas, e
  mostra tudo para você **revisar antes de gravar**. Funciona igual com o texto
  do PDF que o próprio LinkedIn gera em *Mais → Salvar em PDF*, ou com um
  currículo colado.
- **Link de atualização do profissional:** no perfil do candidato, clique em
  *Link de atualização*. Sai um link (e uma mensagem pronta para WhatsApp) em que
  o próprio profissional revisa os dados, informa pretensão e disponibilidade,
  **dá o consentimento** e, se quiser, pede a exclusão. O que ele enviar entra
  direto no sistema. É o substituto honesto da "sincronização automática": em vez
  de vigiar o perfil dele, você o convida a manter os dados certos — e ganha o
  registro de consentimento junto.
- **Reimportar quando quiser:** *Atualizar pelo LinkedIn* refaz a leitura por cima
  do cadastro existente, preservando notas, pareceres e histórico.

> A leitura do texto colado é heurística: o LinkedIn muda o layout com
> frequência. Por isso a tela de revisão existe — trate o resultado como um
> rascunho adiantado, não como verdade absoluta.

---

## LGPD

Recrutamento é tratamento de dados pessoais, então o sistema registra o mínimo
necessário para você sustentar a operação:

- **Fonte do dado** em cada perfil ("perfil público do LinkedIn", "indicação",
  "atualizado pelo próprio profissional"…).
- **Consentimento**: status, data, base legal (consentimento, legítimo interesse
  ou procedimentos preliminares de contrato) e como foi obtido. A lista de
  candidatos mostra quem ainda está pendente.
- **Portal do titular**: pelo link de atualização o profissional acessa, corrige
  e pode **pedir a exclusão** — que apaga o cadastro e o tira dos pipelines.
- **Eliminação pelo consultor**: botão *Excluir dados* no perfil.
- **Registro de atividades**: quem entrou, quem mudou de etapa, quem foi
  eliminado, com data.

Isso é instrumentação, não parecer jurídico. Se a consultoria for tratar volume
relevante, vale um DPO ou advogado revisar a política de retenção (por quanto
tempo manter perfis não contratados) e o texto de consentimento do portal, que
está em `public/atualizar.html`.

---

## Estrutura

```
recrutamento/
├── recrutamento.html      # o sistema inteiro num arquivo só (dois cliques)
├── gerar-arquivo-unico.js # regera o arquivo acima a partir de public/
├── server.js              # servidor local, sem dependências
├── dados/
│   ├── base.json          # toda a base (candidatos, clientes, assignments)
│   └── backups/           # cópia diária automática
└── public/
    ├── index.html         # o sistema
    ├── app.js             # telas, pipeline, importador, relatórios
    ├── atualizar.html     # portal do candidato (link de atualização)
    └── style.css
```

Sem banco de dados, sem `npm install`, sem build. Para levar tudo para outro
computador, copie a pasta — ou use *Backup → Exportar tudo (JSON)*.

Mexeu em algo dentro de `public/`? Rode `node recrutamento/gerar-arquivo-unico.js`
para atualizar o `recrutamento.html`.

---

## Próximos passos possíveis

Coisas que fazem sentido quando a operação crescer, em ordem de retorno:

1. **Vários usuários ao mesmo tempo** — hoje a trava de concorrência é simples
   (quem gravou por último com versão velha é avisado e recarrega). Com 3+
   consultores gravando junto, vale trocar o arquivo JSON por SQLite.
2. **Extensão de navegador** para importar do LinkedIn em um clique, no lugar do
   copiar/colar.
3. **Envio de e-mail/WhatsApp direto do sistema** (hoje ele gera a mensagem
   pronta para copiar).
4. **Portal do cliente** — o contratante acompanha o funil da própria busca, sem
   você precisar mandar relatório.
5. **Agenda de entrevistas** integrada ao calendário.
