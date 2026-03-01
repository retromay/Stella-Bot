# BDO SEA Node War Data - Research Findings

## Summary

There is **no official Pearl Abyss API** for guild or node war data. No third-party service automatically tracks node war results for SEA. Every existing Discord bot uses manual user input for NW data.

---

## Data Sources Investigated

### Official Pearl Abyss

- No public API exists. Community requests since 2021 have been ignored.
- **Guild profile pages** are scrapable and expose an "Occupying" field (which node/territory a guild holds).
- SEA guild profile URL: `https://blackdesert.pearlabyss.com/ASIA/en-US/Game/Guild/Profile?_regionType=1&_guildName={GuildName}`
- Data has a lag of several hours. No NW history, battle stats, or participation data — only current snapshot.
- Pages load data via JavaScript (`_abyss.adventure.guildProfileInit()`), so scraping requires a headless browser or similar.

### BDO-REST-API (community-api.cutepap.us)

- Open-source Go scraper: [man90es/BDO-REST-API](https://github.com/man90es/BDO-REST-API)
- Endpoints: `/v1/guild`, `/v1/guild/search`, `/v1/adventurer`, `/v1/adventurer/search`
- **Does NOT support SEA** — only EU, NA, SA, KR.
- Could be forked and extended for SEA support.
- GuildYapper uses this as its data backend.

### GuildYapper (guildyapper.com)

- Discord bot for guild & alliance management.
- NW features (signups, attendance, party tools) are **all user-input driven**.
- Does NOT scrape or auto-detect NW data from the game.
- Uses BDO-REST-API for guild profile lookups.

### Garmoth.com

- Market data comes from Pearl Abyss's **internal marketplace API** (separate system from guild/NW data).
- Market API endpoints: `/Home/GetWorldMarketHotList`, `/Home/GetWorldMarketSubList`, etc.
- SEA base URL: `https://trade.sea.playblackdesert.com/Home`
- **No node war or guild data whatsoever.**

### Arsha.io (api.arsha.io)

- Public caching proxy for the marketplace API: [guy0090/api.arsha.io](https://github.com/guy0090/api.arsha.io)
- Supports SEA: `https://api.arsha.io/v2/sea/GetWorldMarketHotList`
- **Market data only. Zero NW relevance.**

### Bdolytics.com

- Game database (items, quests, NPCs, recipes). No guild/NW data.

---

## Packet Sniffing / Game Client Data

### Feasibility

Fort placement data is locked inside BDO's encrypted client-server protocol. To capture it you'd need to:

1. Run the game client
2. Reverse engineer the proprietary binary protocol
3. Decrypt packet traffic
4. Handle opcode changes every patch

### Anti-Cheat: XIGNCODE3

- Kernel-level (ring-0) driver by Wellbia
- Scans processes, DLLs, memory, connected hardware
- Monitors for hooks, debuggers, cheat signatures

### ToS Violations

BDO ToS explicitly prohibits:
- Reverse engineering, decompiling, or disassembling the game
- Using unauthorized third-party programs
- Intercepting or modifying game communications

Ban precedent exists (player "Bloo" permanently banned for data analysis).

### Existing Sniffers

| Tool | Type | Targets | Status |
|------|------|---------|--------|
| [BDOHook](https://github.com/iblazys/bdohook) | DLL injection | Generic packets | Unmaintained, private server only |
| [ikusa_logger](https://github.com/sch-28/ikusa_logger) | Network (Npcap) | Combat logs only | Active, but no NW data |
| [Oasis](https://github.com/michaelpittino/Oasis) | Network proxy | Research | WIP |

**None target fort placement or NW signup data.**

---

## Existing Discord Bots

| Bot | NW Data Source | Status |
|-----|---------------|--------|
| GuildYapper | Manual input | Active |
| LookingAtYouFunny | Manual (`!yes`/`!no` commands) | Active |
| BDO-botNET | Manual commands | Active |
| NodewarDiscordBot | OCR from screenshots | Active |
| ShotCaller | Voice coordination (no data) | Active |
| Canute.gg | N/A | **Shut down** |

**Every single bot uses manual input for NW data.**

---

## NW Schedule (Static Data)

Node wars occur **daily 9-10 PM server time, except Saturdays** (Siege/Conquest).

- 40 total battlefields across 4 tiers
- Tier 1 Beginner: 4 nodes, 20-30 players
- Tier 1 Intermediate: 5 nodes, 25-35 players
- Tier 2: 11 nodes, 30-50 players
- Tier 3: 12 nodes, 40-70 players
- Tier 4: 8 nodes, 50-100 players

Guilds can own max 3 nodes, 1 placement per day, 1 participation per week (resets Saturday 00:00).

---

## Conclusion

**Automated NW data is not possible** without violating ToS and risking a permanent ban. The only viable approach is manual input via Discord commands, which is what every existing bot does. Feature was shelved.

### If Revisited Later

The most practical approach would be:
1. **Manual input commands** — admins/scouts report NW intel via bot commands
2. **Guild profile scraping** (optional) — periodically scrape Pearl Abyss SEA guild profiles to detect occupation changes post-NW
3. **Fork BDO-REST-API** — extend with SEA region support for guild lookups
