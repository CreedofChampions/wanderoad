# Cozy Driver — status

**Live:** https://crumbtown.org/cozydriver/ · **Base44:** https://cozy-driver-df0dc17b.base44.app
**App ID:** `6a693b019ee79338df0dc17b`
**Proof standard:** every ✅ below has a measured number or a named tool. Nothing is ticked on a claim.

## This round — the urgent six

| # | Request | Done | Proof |
|---|---|---|---|
| 1 | Spawn facing the OPPOSITE way | ❌ **HELD** | Built (one line, `+ Math.PI`). Driving out that way routes through a crossing **3.63 m out of level** (browser R2, 1/9, reproduced twice). Pre-existing, not caused by it — the old heading never sampled it. Shipping would aim every new player at the exact fall-through we spent days killing. Restore condition written at the code site: put it back when R2 reads 0/9. |
| 2 | Alpine road-network disaster | ✅ | Segments over 15% grade **38.8% → 28.9%**, worst **131% → 96%** — now level with rolling (27.4%). Cause was massif peak 1.7 forcing the lattice up domes, not the roads. Still spawns in snow. |
| 3 | Roads that lead nowhere | ❌ **REVERTED** | Second-ply cull on the LIVE degree took dead ends **6.1 → 2.8 per 16 km²**, but junction density fell to **60.3%** against a 66% floor; far-node-only still 65.1%. Not worth breaking a density bar. Existing dead ends already get a turning head + closing bar. |
| 4 | Gas station full hitbox | ⚠️ **MEASURES WORKING** | `bench-props`: 7 colliders registered with the resolver, **0 buried**, worst drawn structure outside a hitbox **0.228 m** (pump hose nozzles, deliberate). Needs your repro — I won't blind-edit a passing system. |
| 5 | Bumpy slide down cliff | ✅ *(committed, was in this build)* | Descent: **58.9% of frames airborne → 18.9%**, max visual gap **26 cm → 8 cm** at 92 km/h. Droop-band grounding + hill suction + rebound clamp. |
| 6 | Car forever slow on sand | ✅ | Severity halved (crr 0.5→0.25, cap 2.3→4.6 m/s, drag 700→350) **and** a stopped car now drains bog — it was slow because bogged and bogged because slow. |

## Also this round
| Request | Done | Proof |
|---|---|---|
| Coins 1/km max | ✅ | **0.9 coins/km** measured on a real drive (was ~26) |
| Boat at 50 coins | ✅ | `BOAT_UNLOCK_COINS = 50` |
| Emoji invisible on Win10 | ✅ | All emoji removed from the loot counter |
| Large refuel range | ✅ | 11 m → **26 m** |
| Junction stripes flashing | ✅ | Two overlays sat in the same plane; deterministic sub-mm per-junction stagger |
| Gas cans −50% | ✅ | One every **552 m**, still 17 within a 9.5 km tank |
| Dunes off-road −50% | ✅ | See item 6 |
| Base44 backend | ✅ | Deployed, 3 entities, App ID above |

## Gates
`npm test` fully green · `npm run test:browser` **40/40 "THE GAME WORKS"** · live **40/40**

## Still yours
- **Video demo** — the form scores polish and asks for one.
