// Token Radar v2 dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, five-way filtering, sortable columns,
// a per-protocol detail view with the four model factors broken out, and the
// farm plan. No network: every byte it shows is in data.js. The page recomputes
// each row with impliedOf below, the same arithmetic as lib/model.ts, so the
// screenshots, the page code and board.json visibly agree.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', segment: 'all', trend: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function multOf(row) {
    var m = DATA.category_multiples || {};
    return (row.category && m[row.category] !== undefined) ? m[row.category] : DATA.default_multiple;
  }
  // The model in one function, identical to impliedValue in lib/model.ts:
  // category multiple, asymmetric growth, four-year maturity, chain breadth.
  function impliedOf(row) {
    var model = DATA.model;
    var g = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var w = g >= 0 ? model.growth_gain_weight : model.growth_loss_weight;
    var growthMult = Math.max(0.2, 1 + (g / 100) * w);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains ? row.chains.length : 1) - 1, 0), model.breadth_max_extra);
    var breadth = 1 + extra * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * multOf(row) * growthMult * maturity * breadth));
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  // Farm plan derivation, the same rules as farmSteps in lib/model.ts:
  // category picks the actions, first chain picks the gas tier, TVL picks the
  // capital, age picks the hold, and a 7d fall of 10 percent or more turns the
  // monitoring step into a warning.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return { first: 'about $12 of gas for the first transaction', weekly: 'about $6 of gas a week', unit: 6 };
    if (c === 'solana') return { first: 'under $1 of gas for the first transaction', weekly: 'under $1 of gas a week', unit: 1 };
    if (c === 'bitcoin') return { first: 'about $4 of network fees for the first transaction', weekly: 'about $2 of fees a week', unit: 2 };
    return { first: 'about $2 of gas for the first transaction', weekly: 'about $1 of gas a week', unit: 1 };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250; if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100; if (p.tvl_usd >= 2e7) return 75; return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60; if (age < 365) return 45; return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase(); var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow no more than $' + Math.round(capital / 2) + ' against it so the health factor stays wide.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + " split evenly across both sides of " + name + "'s main pool on " + chain + ' and keep the LP position open.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and keep the vault shares, not a wrapped copy.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then make one swap with the bridged funds so the trip is real usage.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade, then close it inside a week.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one position in ' + name + "'s most liquid market, sized so a total loss is acceptable.";
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into one ' + name + ' vault on ' + chain + " and keep the shares; note the curator's name in your log.";
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold the minted asset.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield asset on " + chain + ' and hold it; check the redemption window before you mint.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for the shortest term it sells and keep the policy NFT.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + "'s chain, make one swap and one transfer there, and keep a small balance on the chain.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, chain) {
    var c = (p.category || '').toLowerCase(); var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'In week two, repay part of the borrow and re-supply it on ' + name + ', so the wallet shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'In week two, add a small second deposit to ' + name + ' on ' + chain + ' rather than moving the first one, so the position ages in place.';
    if (c.indexOf('bridge') >= 0) return 'In week two, bridge a small amount back through ' + name + ' and bridge in again, so both directions appear in the wallet history.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'In week two, claim any staking rewards on ' + name + ' and restake them once, keeping the reward transaction in the same wallet.';
    return "In week two, repeat " + name + "'s core action once at a small size on " + chain + ', so the wallet shows returning use, not a single visit.';
  }
  function stepText(s) { return s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; }
  function farmSteps(p) {
    var chain = chainOf(p); var gas = gasFor(chain); var capital = capitalFor(p); var hold = holdDaysFor(p.age_days);
    var dropping = (p.change_7d || 0) <= -10;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm ' + p.name + ' with, and keep its seed phrase offline.', cost: gas.first, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas.unit * 2 + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, chain), cost: gas.weekly, time: '10 minutes in week two' },
      { text: 'Make one qualifying action each week after that, such as a deposit, a borrow, a swap or a vote on ' + p.name + '.', cost: gas.weekly, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: dropping ? "Re-check " + p.name + "'s TVL before adding anything: it fell " + Math.abs(p.change_7d || 0).toFixed(1) + ' percent in seven days, so add nothing until it holds for a full week.' : "Once a week, re-check " + p.name + "'s TVL and your position size; if TVL falls more than 20 percent in a week, stop adding and review the exit.", cost: 'nothing to check, and never pay to claim a reward', time: '5 minutes a week' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and unwind by reversing step two in one visit when you are done.', cost: 'about $' + gas.unit * 2 + ' of gas to unwind', time: '10 minutes to log, 15 minutes to unwind' }
    ].map(stepText);
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('segment')) state.segment = params.get('segment');
    if (params.get('trend')) state.trend = params.get('trend');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.segment !== 'all') params.set('segment', state.segment);
    if (state.trend !== 'all') params.set('trend', state.trend);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.segment !== 'all' && r.segment !== state.segment) return false;
      if (state.trend === 'growing' && !((r.change_7d || 0) > 0)) return false;
      if (state.trend === 'shrinking' && !((r.change_7d || 0) < 0)) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir; if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar v2' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index, frozen' }),
        el('span', { text: DATA.model_version + ' four-factor model' })));
  }
  function lede() {
    var growing = DATA.rows.filter(function (r) { return (r.change_7d || 0) > 0; }).length;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Pre-token protocols, ranked by ', el('em', { text: 'what a launch could be worth' })),
        el('p', { text: 'Every watchlist protocol is covered, then the radar keeps looking: large pre-token protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor, plus the fastest growers the size pass would miss. Implied value is a stated model, not a promise, and protocols whose token already trades are set aside, never ranked.' })),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', null, String(DATA.watchlist_size), el('small', { text: ' / ' + DATA.watchlist_size }))),
        el('div', { class: 'fact' }, el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows found' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Growing this week' }), el('b', null, String(growing), el('small', { text: ' of ' + DATA.board_size })))));
  }
  function selectField(id, label, values, current, onchange) {
    var sel = el('select', { id: id, 'aria-label': label },
      values.map(function (v) { return el('option', { value: v[0], text: v[1], selected: v[0] === current ? 'selected' : null }); }));
    sel.addEventListener('change', function () { onchange(sel.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), sel);
  }
  function segButton(value, label) {
    return el('button', { type: 'button', 'aria-pressed': state.segment === value ? 'true' : 'false', text: label,
      onclick: function () { state.segment = value; writeHash(); render(); } });
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token, set aside', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      selectField('trend', '7d trend', [['all', 'Any trend'], ['growing', 'Growing'], ['shrinking', 'Shrinking']], state.trend, function (v) { state.trend = v; }),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Radar segment' }),
        el('div', { class: 'seg' }, segButton('all', 'All rows'), segButton('watchlist', 'Watchlist'), segButton('early', 'Early finds'))),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }
  function sortHeader(key, label, cls) {
    return el('th', { scope: 'col', class: cls || '' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches those filters' }),
        el('p', { text: 'Clear the search or widen a filter to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.segment = 'all'; state.trend = 'all'; writeHash(); render(); } })));
    }
    var maxLog = Math.log10(Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, el('span', { class: 'badge ' + (r.segment === 'watchlist' ? 'w' : 'e'), text: r.segment === 'watchlist' ? 'WATCHLIST' : 'EARLY' })),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((Math.log10(r.implied_value_usd) / maxLog) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', null, el('span', { class: 'status', text: 'no token on record' })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols by implied value. WATCHLIST rows are the house floor, covered in full. EARLY rows are pre-token finds below it. Select a row for its factor breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank', 'num'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL', 'num'),
          sortHeader('growth', '7d', 'num'), sortHeader('age', 'Age', 'num'), sortHeader('implied', 'Implied value', 'num'),
          el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Set aside, not ranked: these protocols already trade, so their market cap is a market fact, not a model output.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
  }
  function modelPanel() {
    var m = DATA.model;
    var entries = Object.keys(DATA.category_multiples || {}).sort(function (a, b) { return DATA.category_multiples[b] - DATA.category_multiples[a]; });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed: four factors, no names' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot figures alone. A protocol is never boosted or cut because of its name; change the category, the growth, the age or the chain count and the number moves, change nothing else and it does not.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl x category_multiple x growth_x x maturity_x x breadth_x )' }),
      el('p', { class: 'sub', text: 'growth_x credits a gain at ' + m.growth_gain_weight + ' per unit and charges a loss at ' + m.growth_loss_weight + ', with the 7d change clamped to ' + m.growth_floor + ' to +' + m.growth_cap + ' percent, so bleeding TVL hurts more than a spike helps. maturity_x runs ' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range) + ' over ' + Math.round(m.maturity_days / 365) + ' tokenless years (unknown age counts as ' + m.unknown_age_days + ' days). breadth_x adds ' + Math.round(m.breadth_per_chain * 100) + ' percent per extra chain, up to ' + m.breadth_max_extra + ' extra chains.' }),
      el('div', { class: 'mult-grid' }, entries.map(function (k) {
        return el('div', { class: 'mult' }, el('span', { text: k }), el('b', { text: 'x' + DATA.category_multiples[k].toFixed(2) }));
      })),
      el('p', { class: 'sub', text: 'Category multiples, above, are the share of TVL a launch claim is credited with: fee-taking venues monetise TVL fastest, curator and bridge TVL slowest. Everything else uses x' + DATA.default_multiple.toFixed(2) + '. The detail view recomputes the row live and shows each factor, so any reader can audit a number in seconds.' }));
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function factorRow(label, value, pct) {
    return el('div', { class: 'factor' },
      el('span', { text: label }),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.min(100, pct)) + '%' })),
      el('b', { text: 'x' + Number(value).toFixed(2) }));
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug; writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var peers = DATA.rows.filter(function (r) { return r.category === row.category && r.slug !== row.slug; });
    var peerNote = peers.length ? peers.length + ' other ' + (row.category || 'Other') + ' rows share the x' + multOf(row).toFixed(2) + ' category multiple; this row outranks or trails them on TVL, growth, age and breadth alone.' : 'No other board row shares this category, so its multiple is compared against the x' + DATA.default_multiple.toFixed(2) + ' default.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' - ' + (row.segment === 'watchlist' ? 'watchlist floor' : 'early find below the floor') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, factor by factor' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age, no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String(row.chains ? row.chains.length : 0) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: 'x' + multOf(row).toFixed(2) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))),
      factorRow('Growth factor', row.growth_multiplier, row.growth_multiplier * 55),
      factorRow('Maturity factor', row.maturity_multiplier, row.maturity_multiplier * 90),
      factorRow('Breadth factor', row.breadth_multiplier, (row.breadth_multiplier - 0.9) * 300),
      el('p', { class: 'sub', text: 'Recomputed on this page as ' + fmtUsd(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' ' + peerNote + ' An estimate, not a price.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Verdict for a farmer' }),
      el('div', { class: 'verdict', text: 'Outlook: ' + (row.outlook || 'steady') + '. ' + ((row.change_7d !== null && row.change_7d <= -10)
        ? 'Caution first: TVL is falling fast this week. The plan below still works, but its monitoring step is a hard stop, not a reminder.'
        : (row.segment === 'early'
          ? 'Early find: below the house floor, so size the position at the plan amounts and no more until it has held for a month.'
          : 'Core board row: covered by the watchlist floor, with the full plan below sized to its TVL.') )})));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan: seven steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        return el('li', null,
          el('b', { text: at >= 0 ? s.slice(0, at) : s }),
          el('span', { class: 'cost', text: at >= 0 ? s.slice(at + 1) : '' }));
      }))));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
