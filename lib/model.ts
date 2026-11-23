// Token Radar model v2: one snapshot in, one ranked board out.
//
// What changed from a flat TVL multiple, and why:
//   1. Category multiple. A dollar of TVL is not worth the same everywhere:
//      fee-taking venues (Dexs, Derivatives, Chain) monetise TVL directly,
//      lending and CDP monetise it more slowly, and curator / allocator TVL is
//      largely other people's strategies, so it earns the lowest multiple.
//      The multiple comes from the protocol's category alone, never its name.
//   2. Asymmetric growth. Seven-day growth is clamped to -50..+100 percent.
//      Gains are credited at 0.6 per unit and losses are charged at 0.9 per
//      unit, so a shrinking protocol must be much bigger to outrank a growing
//      one. Chasing a one-week spike is damped; bleeding TVL is not forgiven.
//   3. Maturity. A protocol that has run longer with no token on record has
//      more product history behind a launch claim: 0.55 + 0.45 over 4 years.
//   4. Breadth. Distribution across chains is real reach: +4 percent per
//      extra chain, capped at five extra chains (+20 percent).
//
//   implied = round( tvl_usd x category_multiple x growth_multiplier
//                    x maturity_multiplier x breadth_multiplier )
//
// The board covers every watchlist slug, then adds early rows in two passes:
// the largest rankable pre-token protocols below the floor by TVL, and the
// strongest growers among the rest, so a small protocol with real momentum
// is found before it crosses the floor. No name is ever special-cased.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_gain_weight: number;
  growth_loss_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
  default_multiple: number;
}

export const MODEL: ModelConstants = {
  growth_gain_weight: 0.6,
  growth_loss_weight: 0.9,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_extra: 5,
  default_multiple: 0.25,
};

export const MODEL_VERSION = 'radar-2';

/** Category multiples: the share of TVL a launch claim is credited with, by category. */
export const CATEGORY_MULTIPLES: Record<string, number> = {
  'Chain': 0.6,
  'Dexs': 0.45,
  'Derivatives': 0.5,
  'Lending': 0.35,
  'CDP': 0.3,
  'Yield': 0.3,
  'Yield Aggregator': 0.28,
  'RWA': 0.28,
  'Leveraged Farming': 0.26,
  'Liquidity Manager': 0.26,
  'Staking Pool': 0.22,
  'Risk Curators': 0.22,
  'Onchain Capital Allocator': 0.22,
  'Basis Trading': 0.2,
  'Bridge': 0.15,
  'Cross Chain Bridge': 0.15,
  'Canonical Bridge': 0.12,
};

export function categoryMultiple(category: string | null): number {
  if (category === null) return MODEL.default_multiple;
  return CATEGORY_MULTIPLES[category] ?? MODEL.default_multiple;
}

/** Early pass sizes: large caps by TVL, then momentum names the TVL pass missed. */
export const EARLY_TVL_ROWS = 130;
export const EARLY_MOMENTUM_ROWS = 90;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A row's short-term outlook, from its seven-day change alone. */
export type Outlook = 'rising' | 'steady' | 'cooling';

export function outlookFor(change7d: number | null): Outlook {
  if (change7d === null) return 'steady';
  if (change7d >= 3) return 'rising';
  if (change7d <= -3) return 'cooling';
  return 'steady';
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  segment: 'watchlist' | 'early';
  outlook: Outlook;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  segment: 'watchlist' | 'early';
  outlook: Outlook;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  category_multiples: Record<string, number>;
  default_multiple: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface Scored {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  multiple: number;
  age: number | null;
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): Scored {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_gain_weight : model.growth_loss_weight;
  const growthMult = Math.max(0.2, 1 + (growthPct / 100) * weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const multiple = categoryMultiple(protocol.category);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, multiple, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const slugCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  const segment = new Map<string, 'watchlist' | 'early'>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) {
      chosen.set(slug, p);
      segment.set(slug, 'watchlist');
    }
  }
  const rest = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd);
  const byTvl = [...rest].sort((a, b) => b.tvl_usd - a.tvl_usd || slugCmp(a.slug, b.slug)).slice(0, EARLY_TVL_ROWS);
  for (const p of byTvl) {
    chosen.set(p.slug, p);
    segment.set(p.slug, 'early');
  }
  // Momentum pass: rank what is left by growth first, then TVL, so a fast
  // grower below the floor is on the board before its size alone would put it there.
  const growers = rest
    .filter((p) => !chosen.has(p.slug) && (p.change_7d ?? 0) > 0)
    .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0) || b.tvl_usd - a.tvl_usd || slugCmp(a.slug, b.slug))
    .slice(0, EARLY_MOMENTUM_ROWS);
  for (const p of growers) {
    chosen.set(p.slug, p);
    segment.set(p.slug, 'early');
  }

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || slugCmp(a.p.slug, b.p.slug));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    segment: segment.get(p.slug) ?? 'early',
    outlook: outlookFor(p.change_7d),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas tier by chain family: mainnet is dear, L2 and alt-L1 chains are cheap. */
export function gasFor(chain: string): { first: string; weekly: string; unit: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { first: 'about $12 of gas for the first transaction', weekly: 'about $6 of gas a week', unit: 6 };
  if (c === 'solana') return { first: 'under $1 of gas for the first transaction', weekly: 'under $1 of gas a week', unit: 1 };
  if (c === 'bitcoin') return { first: 'about $4 of network fees for the first transaction', weekly: 'about $2 of fees a week', unit: 2 };
  return { first: 'about $2 of gas for the first transaction', weekly: 'about $1 of gas a week', unit: 1 };
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow no more than $${Math.round(capital / 2)} against it so the health factor stays wide.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} split evenly across both sides of ${name}'s main pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares, not a wrapped copy.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then make one swap with the bridged funds so the trip is real usage.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the same wallet.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, then close it inside a week.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one position in ${name}'s most liquid market, sized so a total loss is acceptable.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into one ${name} vault on ${chain} and keep the shares; note the curator's name in your log.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the minted asset.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it; check the redemption window before you mint.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for the shortest term it sells and keep the policy NFT.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain, make one swap and one transfer there, and keep a small balance on the chain.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `In week two, repay part of the borrow and re-supply it on ${name}, so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield')) return `In week two, add a small second deposit to ${name} on ${chain} rather than moving the first one, so the position ages in place.`;
  if (c.includes('bridge')) return `In week two, bridge a small amount back through ${name} and bridge in again, so both directions appear in the wallet's history.`;
  if (c.includes('staking') || c.includes('restak')) return `In week two, claim any staking rewards on ${name} and restake them once, keeping the reward transaction in the same wallet.`;
  return `In week two, repeat ${name}'s core action once at a small size on ${chain}, so the wallet shows returning use, not a single visit.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * Every number is derived from the protocol's own record: its category picks
 * the actions, its first chain picks the gas tier, its TVL picks the capital,
 * its age picks the hold, and its seven-day change picks the warning.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  // The warning step keys off the row's outlook: a cooling row (down 3 percent
  // or more) gets the softer watch wording, and only a fall of 10 percent or
  // more earns the hard stop in step six below.
  const dropping = outlookFor(p.change_7d) === 'cooling' && (p.change_7d ?? 0) <= -10;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`,
      cost: gas.first,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas.unit * 2} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: gas.weekly,
      time: '10 minutes in week two',
    },
    {
      text: `Make one qualifying action each week after that, such as a deposit, a borrow, a swap or a vote on ${p.name}.`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: dropping
        ? `Re-check ${p.name}'s TVL before adding anything: it fell ${Math.abs(p.change_7d ?? 0).toFixed(1)} percent in seven days, so add nothing until it holds for a full week.`
        : `Once a week, re-check ${p.name}'s TVL and your position size; if TVL falls more than 20 percent in a week, stop adding and review the exit.`,
      cost: 'nothing to check, and never pay to claim a reward',
      time: '5 minutes a week',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and unwind by reversing step two in one visit when you are done.`,
      cost: `about $${gas.unit * 2} of gas to unwind`,
      time: '10 minutes to log, 15 minutes to unwind',
    },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    segment: row.segment,
    outlook: row.outlook,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => r.segment === 'early').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    category_multiples: CATEGORY_MULTIPLES,
    default_multiple: MODEL.default_multiple,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
