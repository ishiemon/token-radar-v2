# token-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ishiemon/token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ishiemon/token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks pre-token protocols by a four-factor implied value model: a category multiple on TVL, asymmetric seven-day growth (losses charged harder than gains are credited), four-year maturity for time run with no token on record, and chain breadth. The board covers the full watchlist, then adds early finds in two passes, by size and by momentum, and every row carries a seven-step farm plan whose actions, capital, gas and hold are derived from that protocol's own category, chain, TVL, age and trend. The dashboard is sortable and filterable by search, category, chain, trend and radar segment, with a detail view that recomputes each row factor by factor. Protocols whose token already trades are set aside with their market caps, never ranked.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
