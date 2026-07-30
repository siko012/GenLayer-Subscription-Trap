# Offramp — Dark pattern detector

Offramp audits subscription flows for dark patterns — deliberately deceptive UI/UX that tricks users into unwanted subscriptions. A reviewer submits a flow URL and a review bond. GenLayer validators assess the flow against a checklist of known dark patterns and return a verdict.

## Detection categories

The validator prompt checks for these patterns:

| Pattern | Detection |
|---|---|
| Hidden costs | Fees or charges disclosed only after payment |
| Mismatched buttons | Accept/reject button styling reversed |
| Pre-checked add-ons | Unnecessary extras auto-selected |
| Confusing language | Ambiguous or misleading labels |
| Forced continuity | No obvious opt-out after signup |
| Roach motel | Easy to enter, hard to cancel |

## Scoring

| Obstacles | Verdict |
|---|---|
| 0 | `CLEAN` — bond returned |
| 1–2 | `GREY` — reviewer loses half bond |
| ≥ 3 | `DARK_PATTERN` — reviewer loses full bond |

Each obstacle found reduces confidence. The validator must assign an `obstacle_count` and validators must agree within ±1.

## Contract

- **Network:** GenLayer Studionet (61999)
- **Address:** `0x7f63cb5322341CrA4C6012C5B635Bdf1dC440B3E`
- **Language:** Python (py-genlayer)

The reviewer posts a bond of at least 50 GEN when submitting an audit. The bond is forfeited proportionally to the severity of the dark patterns found.

## Frontend

```sh
cd frontend
npm install
npm run dev
```

React 18 + wagmi + RainbowKit + genlayer-js. Features a submit-audit form, a result card with obstacle breakdown, and a recent-audits feed.

## License

MIT
