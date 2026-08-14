# 🎸 Repertório

App **local** pra acessar suas cifras (`.txt`) e montar repertórios pra tocar
no **iPad**. Roda no seu notebook, sem depender de internet nem de nuvem — o
iPad acessa pelo Safari na mesma rede Wi‑Fi.

## Recursos

- 📄 Lê suas cifras `.txt` da pasta `cifras/` (estilo CifraClub)
- 🔎 Busca por música ou artista
- 🎚️ **Transpor tom** (+/‑ semitons), com detecção automática dos acordes
- 📜 **Rolagem automática** com velocidade ajustável (tocar sem as mãos)
- 🔠 Ajuste de fonte e **modo escuro** (bom pro palco)
- 🎵 **Repertórios (setlists)**: agrupe e ordene as músicas do show e toque
  em sequência (Anterior / Próxima)
- 📲 Dá pra "Adicionar à Tela de Início" no iPad e abrir em tela cheia

## Como usar

### 1. Pré-requisito
Ter o **Node.js** instalado no notebook (versão 14 ou mais nova).
Confira com: `node --version`.

### 2. Colocar suas cifras
Copie seus arquivos `.txt` para a pasta **`cifras/`**. Nomeie assim:

```
Artista - Nome da Música.txt
```

(Veja `cifras/README.md` para detalhes do formato.)

### 3. Iniciar o servidor
No terminal, dentro da pasta do projeto:

```bash
node server.js
```

Vai aparecer algo como:

```
  🎸  Repertório rodando!

  No notebook:   http://localhost:8080
  No iPad:       http://192.168.0.15:8080   (mesma rede Wi-Fi)
```

### 4. Abrir
- **No notebook:** acesse `http://localhost:8080`.
- **No iPad:** conecte na **mesma rede Wi‑Fi** do notebook e abra o endereço
  `http://SEU-IP:8080` que apareceu no terminal. No Safari, toque em
  **Compartilhar → Adicionar à Tela de Início** para usar em tela cheia.

> Dica: mantenha o notebook ligado e o servidor rodando enquanto usa no iPad.
> Se o Wi‑Fi tiver "isolamento de clientes" (comum em redes públicas), o iPad
> pode não enxergar o notebook — use sua rede de casa.

## Sem Node? Alternativa rápida

Se você só quer ler as cifras (sem transpor/repertório do jeito completo),
o app precisa do servidor pra listar os arquivos. O `server.js` não usa
nenhuma biblioteca externa — basta ter o Node. É o caminho mais simples.

## Estrutura

```
repertorio/
├── server.js          # servidor local (sem dependências)
├── cifras/            # <- suas cifras .txt entram aqui
├── data/              # repertórios salvos (setlists.json)
└── public/            # o app (HTML/CSS/JS)
```

Os acordes e a transposição são calculados no próprio app. Nada sai do seu
notebook.
