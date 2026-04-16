<div align="center">

# 💰 Planner Financeiro Pessoal

**Controle total das suas finanças — sem servidor, sem cadastro, sem nuvem.**  
Seus dados ficam onde devem ficar: com você.

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Bootstrap](https://img.shields.io/badge/Bootstrap_5-7952B3?style=for-the-badge&logo=bootstrap&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-00C896?style=for-the-badge)

</div>

---

## 📖 Sobre o projeto

O **Planner Financeiro Pessoal** é uma aplicação web 100% client-side para gestão de finanças pessoais. Não há backend, banco de dados em nuvem ou autenticação. Todos os seus dados trafegam e residem exclusivamente no seu dispositivo — o "Memory Card" é um arquivo `.xlsx` que você salva e carrega quando quiser, como um videogame antigo.

A proposta é simples: **uma ferramenta poderosa que você realmente controla.**

---

## ✨ Funcionalidades

### 🏠 Dashboard
- Saldo geral consolidado com indicador visual de positivo/negativo
- Visão rápida de todas as contas bancárias e faturas de cartões com saldo em tempo real
- Gráfico de rosca interativo com gastos por categoria do mês
- Cards de entradas e despesas do mês atual
- Lista de transações recentes com layout compacto — título, categoria e valor na mesma linha
- Orçamento mensal por categoria com barras de progresso coloridas e alertas de excesso
- Alerta de contas futuras a pagar

### 💸 Movimentação
- Busca em tempo real por descrição com badge de contagem de resultados
- Filtros compactos de tipo, categoria e conta na mesma linha do título
- Seletor de conta com separadores visuais: `─── Contas Bancárias` 🏦 / `─── Cartões de Crédito` 💳
- Navegador de meses integrado com seletor de modo de visualização
- Três modos de visualização:
  - **Lista** — tabela detalhada com data inline ao título
  - **Caminho (Sankey)** — fluxo visual de entrada → orçamento → categorias de gasto
  - **Solar (Sunburst)** — gráfico hierárquico por categoria, com suporte a tema claro/escuro
- Botão de **duplicar transação** (pré-preenche o formulário com os dados, data de hoje)
- **Confirmação de exclusão rica** — modal com nome, tipo, data e valor antes de deletar

### ⌨️ Atalhos de Teclado
| Tecla | Ação |
|---|---|
| `N` | Nova transação |
| `D` | Dashboard |
| `L` | Lançamentos (Movimentação) |
| `C` | Contas / Cartões |
| `B` | Backup |
| `,` | Configurações |
| `/` | Focar campo de busca |
| `?` | Mostrar todos os atalhos |
| `Esc` | Fechar modal ou painel |

### 📈 Projeção
- Estimativa de evolução do patrimônio para os próximos 12 meses
- Baseada em gastos fixos, parcelas futuras e receitas recorrentes
- Gráfico de linha com resumo mensal projetado

### 🏦 Contas & Cartões
- Cadastro de contas bancárias com saldo inicial
- Cadastro de cartões de crédito com dia de fechamento e vencimento
- Cálculo automático de fatura por período de fechamento
- Histórico das últimas 3 faturas por cartão
- Pagamento de fatura com débito automático na conta selecionada
- Barra de uso do limite com alerta de cor (verde → amarelo → vermelho)

### ⚙️ Configurações
Painel lateral (offcanvas) acessível pelo ícone de engrenagem no desktop ou menu hamburguer no mobile.

- **Tema claro/escuro** — switch com persistência no Memory Card
- **Categorias personalizadas** — adicionar, remover e alterar a cor de cada categoria; cores refletem nos gráficos, badges e barras de orçamento
- **Atalhos de teclado** — lista completa consultável a qualquer momento
- **Limpar dados do navegador** — apaga sessionStorage e localStorage com confirmação

### 💾 Backup — Memory Card
- **Exportação `.xlsx` com formatação premium:**
  - Aba `📊 Resumo` com KPIs coloridos do mês e tabela de gastos por categoria
  - Aba `💸 Transações` com autofilter ativo e células coloridas por tipo
  - Aba `🏦 Contas`, `💳 Cartões` e `🧾 Faturas` formatadas e prontas para análise
  - Aba `📋 Como usar` — guia offline de preenchimento
  - Aba `✏️ Nova Transação` — 50 linhas formatadas para lançar dados sem abrir o app; importadas automaticamente na próxima carga
  - Abas técnicas de reimportação: `Transacoes`, `Contas`, `Cartoes`, `FaturasCartao`, `Configuracoes`
- **Importação** restaura dados, categorias, cores e tema do backup
- Autosave em `localStorage` como camada extra de segurança
- Alerta de backup não salvo ao tentar fechar a aba

---

## 📱 Mobile-First

A interface foi construída com experiência mobile como prioridade:

- **Bottom Tab Bar nativa** em smartphones (Dashboard, Movimentação, +, Contas, Backup)
- **Botão + central** com gradiente para adicionar transações com um toque
- **Menu hamburguer** no canto direito da navbar para acessar Configurações
- **Modais em bottom sheet** (deslizam de baixo para cima)
- Suporte a **safe-area** em iPhones com notch / Dynamic Island
- Alvos de toque mínimos de 40×40px em todos os botões de ação
- Layout responsivo com breakpoints em 768px e 480px

---

## 🗂️ Estrutura do projeto

```
planner-financeiro/
├── index.html      # Estrutura HTML, modais, offcanvas e views
├── styles.css      # Design system, temas claro/escuro, responsividade
├── app.js          # Lógica de UI, renderização, navegação, exportação Excel
└── storage.js      # Engine de dados: CRUD, configurações e formatadores
```

> O projeto é **zero-dependency no servidor** — abra o `index.html` direto no navegador ou sirva via qualquer host estático (GitHub Pages, Netlify, Vercel etc.).

---

## 🚀 Como usar

### Opção 1 — Abrir localmente
1. Clique no botão **Code** no topo desta página e selecione **Download ZIP**
2. Extraia o conteúdo e abra o `index.html` no navegador

```bash
git clone https://github.com/RY0UK3N/Planner.git
cd planner
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

### Opção 2 — GitHub Pages
1. Vá em **Settings → Pages**
2. Selecione a branch `main` e a pasta `/ (root)`
3. Acesse `https://seu-usuario.github.io/Planner`

### Opção 3 — Netlify / Vercel
Conecte o repositório e faça o deploy. Não há build step — o projeto já está pronto.

---

## 🛠️ Tecnologias utilizadas

| Biblioteca | Versão | Uso |
|---|---|---|
| [Bootstrap](https://getbootstrap.com/) | 5.3.3 | Layout, grid, modais, offcanvas |
| [Chart.js](https://www.chartjs.org/) | latest | Gráfico de rosca e comparativo mensal |
| [Apache ECharts](https://echarts.apache.org/) | 5.4.3 | Gráficos Sankey, Sunburst e Projeção |
| [SheetJS (XLSX)](https://sheetjs.com/) | 0.18.5 | Exportação e importação de `.xlsx` |
| [Phosphor Icons](https://phosphoricons.com/) | latest | Ícones da interface |
| [Google Fonts — Inter](https://fonts.google.com/specimen/Inter) | — | Tipografia |

---

## 💡 Filosofia de dados

```
Nenhum dado sai do seu dispositivo.
```

- **Sessão ativa:** `sessionStorage` — limpo ao fechar a aba
- **Autosave local:** `localStorage` — persiste entre sessões no mesmo navegador
- **Backup permanente:** arquivo `.xlsx` salvo por você, onde quiser

O arquivo `.xlsx` é o seu "Memory Card". Ele carrega não só as transações mas também suas categorias personalizadas, cores e preferência de tema. Carregue-o ao abrir o app, salve-o ao terminar.

---

## 📊 Como funciona o cálculo de faturas

O sistema identifica a qual fatura uma despesa pertence com base no **dia de fechamento** do cartão:

- Se o dia da transação é **posterior** ao fechamento → fatura do mês atual
- Se o dia da transação é **anterior ou igual** ao fechamento → fatura do mês anterior

```
Exemplo: Fechamento dia 10
  Compra em 15/mar → Fatura Março (vence em Abril)
  Compra em 08/mar → Fatura Fevereiro (vence em Março)
```

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Para mudanças, abra uma issue primeiro para discutir o que você gostaria de alterar.

1. Fork o projeto
2. Crie sua branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'feat: nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

---

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.

Copyright (c) 2026 **Marcos Luciano Tagliari Junior**

---

<div align="center">

Feito com ☕ e JavaScript. Nenhum dado seu foi para nenhum servidor

</div>
