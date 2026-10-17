# PROJECKT V
## ASTRA

{DISCORD_BOT}

#  — Changelog —

---

## b.0.0.6 — Initial Release
*The original build.*

- Single-step verification: one **Verify** button granting a member role
- PostgreSQL-backed guild settings
- Basic web dashboard (login via Discord OAuth, server selection, verification config)
- `!setupverify` / `!verify` text commands

---

## b.0.0.7 — Stability Pass
**August 12, 2026**
*Fixed a bunch of stuff that was quietly broken under the hood.*

- Fixed a schema race condition where `two_step_enabled` and other columns were silently never created, breaking 2FA with no visible error
- Fixed the session store being handed the wrong object, which could break login persistence
- Added per-guild command sync logging so failed Discord command syncs (e.g. missing OAuth scope) aren't silent anymore
- Moved pending-verification tracking from memory to the database so it survives restarts/redeploys

---

## b.1.0.0 — Admin Roles & Help
**August 12, 2026**
*Made Astra properly configurable, not just admin-only.*

- Added `/help` — context-aware command list
- Added `/config admins add/remove/list` — lets me grant specific roles permission to configure Astra without giving out full Discord Administrator
- Added `/setup` and `!setup 2fa` — an interactive 2FA toggle panel

---

## b.2.0.0 — Two-Step Verification Rework
**August 12, 2026**
*Reworked verification to be role-based instead of click-based.*

- Replaced the old 2FA toggle with a real two-role gate: **Chat A** (rules button) + **Chat B** (`!verify` text command) — both required before the final role gets granted
- Chat B now moderates itself: anything other than `!verify` gets deleted with a warning
- Added an already-verified short-circuit so returning members don't get re-processed
- Added auto-kick for members who never finish verification within a configurable grace period (bots/admins exempt)
- Added anti-scam detection: flags or auto-kicks brand-new accounts with no avatar on join

---

## b.3.0.0 — Commission Ticket System
**August 12, 2026**
*Astra's a ticket bot now too.*

- Added `/artist add/remove/list` and role-based artist registration (`/config artist-roles`)
- Added `/panel` — artists can set their own Terms of Service, Won't-Do list, Ask-Me info, and per-category pricing
- Added private artist "setup channels" with button + modal editing — no slash command syntax to remember
- Built the full ticket flow: **Open a Ticket** → pick an artist → private channel gets created automatically with that artist's live panel posted
- Added spam protection: can't open a second ticket while one's already open

---

## b.4.0.0 — Web Dashboard Overhaul
**August 26, 2026**
*Got the site caught up to the bot.*

- Full dashboard rebuild: verification, anti-scam, and auto-kick settings all editable from the browser now, not just Discord
- Added the `/tickets` admin page — manage artists and edit panels from the web
- Added a real onboarding flow for brand-new servers, with live progress badges
- Made the entire site mobile-responsive (off-canvas nav drawer — it was unusable on phone before)

---

## b.4.1.0 — Login & Security Hardening
**August 26, 2026**
*Fixed the constant logouts, and found a real gap while I was at it.*

- Added Discord OAuth token refresh — sessions don't silently break after ~7 days anymore
- Closed an authorization gap where `/select-server` trusted a submitted server ID without checking real Administrator permission
- Hardened session cookies (`secure`, `httpOnly`, `sameSite`, `trust proxy`) for Render's proxy setup
- Sessions now roll forward on activity instead of hard-expiring after a fixed window

---

## b.5.0.0 — Visual Revamp
**August 26, 2026**
*Made it look like a product instead of a prototype.*

- Full visual pass across every page: ambient background glow, consistent typography, gradient headers
- Rebuilt `/select-server` to only show servers Astra's actually in, with one-click invite links for the rest
- Restyled `/help` to match the rest of Astra's embed design

---

## b.6.0.0 — Rebrand, Localization & Polish
**September 2, 2026**
*Astra, properly finished — for now.*

- Rebranded from "Astra Security" to just **Astra** across every surface, bot and web
- Every page has its own browser title now instead of one generic one everywhere
- Fixed a real setup bug: saving verification/ticket config on the website now actually posts the panel messages to Discord — used to still require running the Discord command afterward
- Added bilingual support: **English** (default) and **Português (Brasil)**, configurable per server via `/config language`, plus a language toggle on the website
- Rebuilt the homepage: it detects if I'm logged in, shows a "Hello, [name]" menu with quick Dashboard/Logout access, or a Login button if not
- Added join/leave logging and a live member count on the dashboard

---

## b.7.0.0 — Admin Quality of Life
**September 2026**
*Made the day-to-day admin experience less of a black box.*

- Added a unified **Astra Logs** audit trail — every config change, on Discord or the website, posts to the server's log channel, tagged with who made it and where from
- Added auto-save across every settings form on the site: flip a toggle or pick a dropdown and it saves instantly, no separate "click Save" step — actions with a real Discord side effect (posting a panel, adding/removing something) still use an explicit button on purpose
- Added `/about` and `/quickstart` — quick-reference commands for new admins, linked from `/help`, so getting set up doesn't require reading every command's syntax first

---

## b.8.0.0 — Rebrand to Projeckt V: Astra & FUI Redesign
**Late September 2026**
*A full visual identity pass, not just a reskin.*

- Renamed the site to **Projeckt V: Astra**
- Full "Anime FUI" visual redesign across every page, inspired by Phantasy Star Online 2: New Genesis — angular clipped panels, cyan/magenta palette, Orbitron/Rajdhani fonts, HUD corner brackets, scanline and grid background effects
- Replaced the old sidebar entirely with a single click/hover popup in the top-left (avatar, username, nav links, logout), the same on every screen size — no permanent drawer, no mobile overlay bug
- Merged the Dashboard and Tickets pages into one unified, tabbed **Configuration** page (Verification / Anti-Scam / Auto-Kick / Tickets / Admin Roles), and fixed the broken `/tickets` nav link that used to error out
- Reworked "Help & Setup" from a wizard that just redirected into Configuration into an actual explanatory guide page
- Reskinned the "Select a Server" page to match the new look (it was still the old indigo style)
- Fixed untranslated homepage feature-card descriptions in Português (Brasil)

---

## b.8.1.0 — Avatar & Language Selector Fixes
**October 9, 2026**
*Small polish pass on top of the redesign.*

- Fixed the Discord avatar not showing up on the site; it now displays correctly everywhere, including on mobile, with a graceful fallback to initials if it fails to load
- Added the Discord profile picture to the nav popup's "Signed in as" block (previously text-only)
- Added an actual Language selector (English / Português (Brasil)) to the Configuration page's Verification tab, autosaving the same way every other setting does — this was the last missing piece of per-server language support
- Note: the avatar shown is the one cached at login time, not a live fetch — it updates on the next login, not instantly if someone changes their Discord avatar mid-session

---

## b.8.2.0 — Deploy Fix & Full Site Translation
**October 10, 2026**
*Fixed a deploy mix-up, then finished the job on Part 3.*

- Fixed a broken deploy: the homepage was rendering raw server source code instead of the actual page — a file mix-up had the wrong content saved into the homepage template. Also fixed a crash on startup where command syncing died because a ticket command the server code expected wasn't actually present in the repo yet
- Fixed "Select a Server" never actually showing Português — it was 100% hardcoded English this whole time, now fully wired to the language system
- The nav popup's EN/PT-BR toggle now actually does something everywhere: on the Configuration/Help pages it writes to that server's saved language (same field as the dropdown below), instead of a disconnected toggle that silently did nothing there; it also now highlights whichever language is currently active, so it's never ambiguous
- Fixed the Language dropdown looking like it didn't work: it was actually saving correctly, it just never visibly changed anything because (a) saving it doesn't reload the page on its own, and (b) almost nothing on the Configuration page was wired to the language system yet. Both fixed: the dropdown now reloads the page after saving, and every tab (Verification, Anti-Scam, Auto-Kick, Tickets, Admin Roles) — every label, button, and message — is now fully translated in both languages
- Finished the same full translation pass on the "Help & Setup" page — every card title, status badge, description, and button now follows the server's language too

---

## b.8.3.0 — Ticket Panel Customization

*Artists can now actually brand their commission panel instead of a plain embed.*

- Added a banner/thumbnail image to each artist's panel, settable via `/panel set-banner` on Discord or the new Banner Image field on the dashboard
- Added up to four social/portfolio link buttons on the panel — Portfolio, Twitter/X, Instagram, and one free-label "Other" slot — settable via `/panel set-link` / `remove-link` or the dashboard's new Links section; the same buttons also show up on the ticket channel itself once a commission is opened
- Both the Discord-side setup channel buttons and the website now validate URLs before saving (must start with `http://` or `https://`) so a typo can't silently produce a dead button
- Also tracked down why `/about` wasn't showing up in Discord's command picker: it was never actually a bug in `/about` — a crash earlier in the startup sequence (`/tickets` overview command missing from the deployed file, fixed last version) was silently failing the *entire* command-sync step on every restart, so no new commands were registering at all. Confirmed fixed now that sync isn't crashing anymore.

---

## b.8.4.0 — Welcome & Leave Messages

*First piece of making her feel more alive — public join/leave messages, Loritta-style.*

- Added public **Welcome Messages**: a dedicated channel + message template get posted whenever someone joins, completely separate from the existing rules/verify nudge and the admin-only join/leave log. Defaults to a styled embed with the new member's avatar; can be switched to plain text
- Added public **Leave Messages** the same way, for when someone leaves
- Both messages support placeholders: `{user}` (mention), `{username}`, `{server}`, `{membercount}` — so the text updates itself per member/server without me having to hardcode anything
- Configurable from Discord (`/config welcome`, `/config leave`) or from a new **Welcome** tab on the dashboard, autosaving like everything else
- This is the first of the four "feel alive" features — leveling/XP, fun/random commands, and economy/daily rewards are next in line

---

## b.8.5.0 — XP & Leveling System

*Second "feel alive" feature — members earn XP from chatting and level up, Mee6/Loritta-style.*

- Added a running XP/level per member per server. Chatting earns a random amount of XP (configurable range, default 15–25) on a cooldown (default 60s) so it can't be farmed by spamming
- Levels use a standard growing curve — early levels come quick, later ones take a lot more chatting
- Added **`/rank`** — shows your (or someone else's) level, total XP, server rank, and progress to the next level, as an embed
- Added **`/leaderboard`** — top 10 members by XP in the server, medals for the top 3
- Added **milestone role rewards**: `/config level-roles add/remove/list` lets me set "reach Level X → automatically get this role", stacking cumulatively as members climb
- Level-up announcements post wherever the member was chatting by default, or a fixed channel if I set one — fully configurable (toggle, channel, message with `{user}`/`{username}`/`{level}`/`{xp}` placeholders, cooldown, XP range) from `/config leveling` on Discord or the new **Leveling** tab on the dashboard, autosaving like everything else
- Role rewards (`/config level-roles`) are Discord-only for now, same as the existing admin-roles/artist-roles pattern — not yet on the website

---

## b.8.6.0 — Mention/Name Replies

*A little personality — NOT a real AI, just a canned-line picker so she feels less static.*

- When someone @mentions Astra or says "astra" in chat, she now replies with a random lighthearted one-liner — no LLM call, no API key, no per-message cost, just a hardcoded pool of lines (separate ones for English and Português, matching whatever language the server is set to)
- Cooldown-gated per server (8 seconds) so a channel repeating her name doesn't get spammed with replies
- On by default (zero-config, harmless) — toggle it off with `/config fun enabled:False` or the new **Fun** tab on the dashboard if it's not your thing
- `commands/fun.js` is the new home for this kind of lightweight extra — future additions like `/meme` or an 8-ball command will likely live there too

---

## b.8.7.0 — Economy & Currency System

*Fourth and final "feel alive" feature — members earn and spend a server currency.*

- Added a per-member currency balance per server, with a customizable name and symbol (default: "Coins" / 🪙)
- Added **`/daily`** — claim a random payout once every 24 hours, with a streak bonus for not missing a day (capped at 10 days so it doesn't grow forever)
- Added **`/balance`** — check your (or someone else's) balance
- Added **`/pay`** — send currency to another member
- Added **`/richest`** — top 10 balances in the server, medals for the top 3
- Configurable (toggle, currency name/symbol, daily payout range, streak bonus) from `/config economy` on Discord or the new **Economy** tab on the dashboard, autosaving like everything else
- No shop or gambling system yet — kept this scoped down on purpose, same spirit as the mention-reply feature; can revisit later if there's demand
- This wraps up all four "feel alive" features requested: welcome/leave messages, XP/leveling, mention replies, and now economy

---

## b.8.7.1 — Deploy Crash Fix

*Caught from the Render logs right after the economy deploy.*

- Fixed a startup crash: two of the new `/config` option descriptions (leveling's channel option, fun's subcommand description) went over Discord's hard 100-character limit on option/subcommand descriptions, which threw during command registration and crashed the bot on boot. Both shortened, bot boots clean again
- Worth flagging for next time: Discord caps every subcommand/option **description** at 100 characters (separate from the 100-char limit on names) — I'll keep new ones under that going forward

---

## b.8.8.0 — Site Language Split From Astra's Language

*Fixed a mixup the user caught: the dashboard's own display language and what Astra says to members were the same setting, which they shouldn't be.*

- `guild_settings.language` (what Astra actually says to members — verification, tickets, welcome/leave, level-ups, etc.) and the brand-new `guild_settings.site_language` (purely which language the Dashboard/Onboarding pages themselves render in) are now two separate columns, backfilled from the old shared value so no one's current site display flips on them
- The nav bar's EN/PT-BR toggle (on Dashboard/Onboarding) now only changes `site_language` — it no longer touches what Astra says in-server
- The Configuration page's "Astra's Language" dropdown still only changes `language`, same as before, but the hint text now explicitly says it's not this page's own language
- Removed the page-reload-on-save behavior from that dropdown — it never needed to reload the page in the first place, that was a side effect of the two settings being tangled together
- Also looked into why `/rank` showed no XP: not a bug — leveling defaults to OFF like every other feature here, needs `/config leveling enabled:True` or the dashboard toggle first
- Noted for later (not acted on): separating where Astra posts config-change notices (currently the shared join/leave log channel) from member join/leave events themselves — the user said it's fine going to an admin-only channel for now, so leaving it as-is

---

## b.8.9.0 — /help Rewrite

*/help was missing more than half of Astra's commands. Rebuilt it from an actual audit of every registered command.*

- `/help` now lists everything: `/rank`, `/leaderboard`, `/balance`, `/daily`, `/pay`, `/richest`, `/tickets`, the full `/panel` set (including set-banner, set-link, remove-link), and every `/config` subcommand (welcome, leave, leveling, level-roles, economy, fun, plus the older ones)
- Organized by who can use it: Everyone (with Levels, Economy and chatting-with-Astra sections), Artists, Astra Admins (split into Setup and Community), Server Administrators
- Artists now see their `/panel` section even if they aren't admins (before, only admins did)
- Fully translated EN/PT-BR; the old help text was partly hardcoded English. Follows Astra's language setting
- Economy is labeled **beta**, and the intro notes some features only work if admins enabled them

---

## b.8.10.0 — Level-Up Role Rewards on the Dashboard

- The **Leveling** tab now has a "Level-Up Role Rewards" section: see every level → role reward, remove one, or add a new one (level 1-1000 + role picker)
- Same list as `/config level-roles` on Discord, so changes from either side show up on both
- Adding a reward for a level that already has one replaces its role, same as the Discord command
- The server checks the role really belongs to your server and isn't @everyone or a bot-managed role before saving; every add/remove is posted to the admin log
- If a rewarded role was deleted in Discord, it shows as "(deleted role)" so you can clean it up
- Fully translated EN/PT-BR; the old "manage this on Discord" hint is gone

---

## b.8.10.1 — Level-Role Hierarchy Warnings

- Astra can only give roles that sit **below** her own role. Before, if a reward role was above hers the grant just failed silently
- Dashboard: a reward whose role Astra can't assign now shows a ⚠ "above Astra's role" badge
- `/config level-roles add` warns right in its reply when she can't assign that role
- If a grant still fails during a level-up, Astra posts one notice in the admin log (once per role until restart) saying to move her role higher

---

## b.8.11.0 — Public Artist Directory

- New **`/artists`** command, open to everyone: lists every artist on the server and has a dropdown to pick one
- Picking an artist shows their full commission panel privately (avatar, ToS, won't-do, ask-me, pricing, banner and link buttons). The dropdown stays open so you can browse several artists
- If tickets are set up, the directory also points people to the ticket channel
- The admin-only `/artist add/remove/list/setup-channel` is unchanged (note: `/artist` is for admins, `/artists` is the public one)
- Added to `/help` under Everyone; fully translated EN/PT-BR (the artist panel text itself is still English, as before)
- **New slash command**: Discord registers it on the next bot restart, no manual step

---

## b.8.12.0 — Separate Admin Notices Channel

- Astra's admin notices ("X updated leveling settings", "X registered Y as an artist", language changes, etc.) can now go to their **own channel**, apart from member join/leave and the other logs
- Set it with **`/config logs admin_channel:#channel`** (run `/config logs` alone to see the current one, `reset:True` to undo) or on the dashboard's Verification tab ("Admin Notices Channel")
- Nothing changes until you pick one: with no admin channel set, notices keep going to the main log channel like before
- Member joins/leaves, scam flags and ticket events stay on the main log channel
- If the admin channel is later deleted, notices fall back to the main log channel instead of disappearing
- New database column `admin_log_channel_id`, added automatically on boot; `/config logs` is a new subcommand (registered on restart)

---

## b.8.13.0 — Experimental Smart Replies (PROTOTYPE)

*First prototype: a small AI model trained for one purpose, helping members understand the server. It matches a message to one of 12 intents and answers with a pre-written line (not a general-purpose chatbot).*

- New **`/config ai enabled:True/False`** and a **Smart Replies** toggle (marked EXPERIMENTAL) in the dashboard's Fun tab. **OFF by default** on every server
- Understands English and Portuguese: greetings, goodbyes, thanks, "how are you", "who are you", "what can you do", how the **economy** works, how **levels/ranking** work, how to **verify**, how to **commission/open a ticket**, compliments and insults (she answers insults with sarcasm)
- Runs on nlp.js (`node-nlp`) locally: no AI service, no per-message cost
- The model is **trained offline** (`npm run train-ai`) and only loaded by the bot, not trained at boot, to stay light on Render's free tier. If the model file is missing she just keeps using her canned lines
- Separate from `/config fun`: when she isn't sure what you meant, or smart replies are off, the usual `/config fun` canned replies happen exactly as before
- If several people call her within a few seconds in the same channel she says she's busy ("one at a time, I'm busy"), and that busy line is rate-limited on its own
- **Not in this prototype:** auto-moderation, explaining more features, memory, longer conversations
- **Requires setup** on your side: `npm install node-nlp`, add the `train-ai` script, train and deploy `ai/model.nlp` (steps in `ai/README.txt`)
- New database column `ai_enabled` (added on boot)

---

## b.8.13.1 — Smart Replies: Personality & Reliability

- **More personality:** chaotic, deadpan lines (several answers per topic, never the same one twice in a row) and new topics: jokes, "say something random", "are you sentient?", "who made you?" and "I'm bored". Her canned `/config fun` lines grew from 16 to 26 per language
- **Smarter answers:** she now uses your server's real settings: your currency name, whether the economy or levels are actually turned on, and your real verify, rules and ticket channels
- **Off-topic class:** she's taught what NOT to answer (weather, football, homework...), so unrelated questions fall back to her usual lines instead of getting a wrong answer
- **Better "busy" behavior:** the same person asking twice in a row just gets quiet; only a *different* person calling her at the same time gets the "I'm busy" line
- **Tools:** `npm run test-ai` shows what the trained model gets right and wrong; `npm run check-ai` catches corpus mistakes before training
- **Safer deploys:** with the new Build Command, if training ever fails the bot still goes live with her normal replies
- Still a prototype: not yet run against the real `node-nlp`; expect to tune it after the first deploy

---

## b.8.15.0 — Smarter Astra, Welcome Message & Role Creator

**Smart Replies, refined (still local: free, nothing leaves the bot)**
- She now understands **40 topics** (was 18). New: what each command does (`/rank`, `/leaderboard`, `/balance`, `/richest`, `/artists`, `/panel`, `/tickets`, `/help`, `/about`), how `/daily` and streaks work, how to `/pay`, level reward roles, becoming an artist, closing a ticket, which languages she speaks, how to reach the mods, where the rules are, why a message got deleted, admin setup and the `/config` switches, "are you ChatGPT / do you read my messages?" (honest answer: no, nothing leaves the bot), plus a few personality topics (favorites, age, sleep, feeling sad, "date me")
- **Points people to `/help`:** a real question she doesn't understand now gets a nudge to `/help` instead of a random line; an off-topic question (weather, football...) gets a polite "not my job, I only know this server". Casual non-questions still get her normal `/config fun` lines
- **Typos and chat slang:** training now adds automatic variations of every phrase (`vc`, `oq`, `pq`, `u`, `ur`, missing accents, swapped/missing letters), and stretched words like "oiiiii" are cleaned up
- Some answers greet people by their server name (never a ping)
- `npm run test-ai` now has 76 test phrases, including typo cases
- Still not run against the real `node-nlp`; expect to tune after the first deploy

**Welcome message when she joins a server**
- The first time Astra is added to a server she introduces herself once, in English and Portuguese, in the system channel (or the first channel she can write in, or the owner's DMs). Points to `/quickstart`, `/config language`, the dashboard, `/help`, and warns if she's missing Manage Roles / Manage Channels / Manage Messages
- Never repeats if she's removed and re-added
- New database column `astra_welcomed` (added on boot)

**Create the level roles from the website**
- Dashboard > Leveling > "Create the roles for me": type the levels (e.g. `10, 20, 30, 40, 50`), a name like `Level {level}`, two colors (the roles fade from one to the other) and optionally "show separately in the member list"
- Roles are cosmetic (no permissions) and each is registered as that level's reward automatically
- Safe by design: levels that already have a reward are skipped, a role with the same name is reused (no duplicates), max 15 per go, checks Manage Roles and the 250-role limit, and says clearly what happened

- **Fix:** she now detects the language of each message before classifying it, so English questions get English answers (before, the Portuguese model sometimes won on English text). Very short or mixed messages use the server's language
- **Fix:** dashboard autosave toggles (including Smart Replies) now save correctly on Express 5

---

## b.8.15.1 — Rewritten `/about` and `/quickstart`

- `/about` is now three pages behind buttons: **What she does** (safety, commissions, levels/economy, smart replies), **Setup guide** (a 7-step tutorial: permissions, verification and what each option means, language/welcome/logs, tickets and artists, levels and economy, protection, dashboard) and **For members** (getting in, levels and money, commissions, how to just ask her)
- `/quickstart` grew from 5 to 7 steps and now covers language, welcome message, logs, levels, level-role rewards and economy, not just verification and tickets
- Everything is in English and Portuguese

---

## b.8.15.2 — Own domain & `/about` fix
**October 16, 2026**

- The dashboard now lives at **projeckt-v.dev** (www redirects there). HTTPS certificate issued automatically; Discord login works on the new address
- To move: add the domain in Render > Settings > Custom Domains, point the two CNAME records at the service in Cloudflare (DNS only), add `https://projeckt-v.dev/callback` in the Discord Developer Portal, and set `REDIRECT_URI` to the same URL. No code change was needed; the site link Astra shows in Discord is built from `REDIRECT_URI`, so it follows by itself
- **Fix:** the `/about` setup guide no longer says members always type `!verify` in the verify channel. That only applies to the two-step setup (en.json and pt-br.json)

---

## b.8.16.0 — Smarter Smart Replies, round 2
**October 16, 2026**

- **Typos:** Astra now repairs misspelled words before giving up. If she isn't sure what you meant, unknown words that are one or two letters away from words she knows are fixed ("how do i verfy" -> "verify", "como funcioan o rank" -> "funciona") and she tries again. Pure JavaScript, no model, no cost. The repaired text is only used when it is clearly a better match
- **8 new topics (48 total):** how to add her to your own server (with the dashboard link), what to do about scams and phishing, "the bot isn't working" (permissions and role order checklist), how much commissions cost, how long a commission takes or what to do when an artist doesn't reply, why a command says "no permission", and how to gain XP faster
- **Follow-ups:** for 3 minutes she remembers the last topic she told someone, so "tell me more", "explain again" or "não entendi" gets another wording of the same answer (or points to `/about`). With no recent topic she asks what you mean. Kept in memory only, never stored
- **Dashboard link in answers:** setup and invite answers now include your real dashboard address (taken from `REDIRECT_URI`), so they follow the domain automatically
- `npm run test-spell` checks the typo fixer without needing the trained model; `npm run test-ai` grew to 101 phrases not in the corpus, including new topics, typos and follow-ups
- Still not measured against the real `node-nlp` (run `npm run test-ai` after the next deploy and tune from the result)
- Discord Developer Portal "About Me" text now mentions projeckt-v.dev (paste it by hand)

---

## b.8.17.0 — Economy, Part 2: Random Events, Shop & Gambling
**October 17, 2026**
*The currency finally has something to do.*

**Random events (off by default)**
- While people chat, Astra now and then posts a button message. Two kinds: a **coin drop** (the first click wins a random amount, usually 25-150, sometimes a lot more, rarely a golden pouch worth 500-1500) and a **coin rain** (45 seconds, everyone can catch once for a random 5-60)
- Never more often than the interval you set (default 45 min, 10-1440), and only when at least two different people have chatted recently, so a quiet server doesn't get spammed. The economy has to be on
- Turn on with `/shopconfig events enabled:True` (optionally a channel and interval) or in Dashboard > Economy > Random Events
- Clicks are race-proof: three people clicking at the same millisecond means exactly one winner and one payout

**Shop**
- `/shop` lists what you can spend on, `/buy` buys it (start typing for the list)
- **Cosmetic roles:** admins sell roles with `/shopconfig add-role name price role` or in Dashboard > Economy > Shop. Roles with powerful permissions (Administrator, managing roles/messages/members/channels, kick/ban, @everyone mentions...) are refused, as are roles above Astra's own or managed by an integration. Max 25 items. If giving the role fails, the buyer is refunded automatically
- **Five built-in silly items** that need no setup: **Town crier** (Astra announces your message, no links, no pings), **Get roasted**, **Get hyped**, **Fake ban** (clearly fake) and a **Mystery box** (random payout that averages about 80% of its price, so it drains coins rather than printing them)
- `/shopconfig view` shows items and event settings; `/shopconfig remove` takes an item out (people keep roles they bought)

**Gambling**
- `/gamble amount:` is a coin flip: 45% to win double, up to 1000 per bet, short cooldown. Slightly rigged on purpose so it removes coins from the economy

**Under the hood**
- Every money change in the shop and events is one atomic SQL statement, so simultaneous buys/clicks can't overdraw or lose an update
- New columns `events_enabled`, `events_channel_id`, `events_interval_min` and a new table `shop_items`, all created on boot
- 4 new commands: `/shop`, `/buy`, `/gamble`, `/shopconfig`. `/help`, `/about`, `/quickstart` and the dashboard text mention them (English and Portuguese)
- Smart replies learned 3 new topics (51 total): what the shop sells, what the random coin drops are, and how gambling works

---

## b.8.18.0 — Banter, Public Stats & a Logo
**October 17, 2026**
*She joins in on the dumb stuff now.*

**Banter (no AI, works even with smart replies off)**
- Say her name (or @mention her) and try: **"guess what?"** (she asks "what?", and your next message gets "chicken butt"), **"knock knock"** (she plays the whole bit and rates your joke), **"tell me a joke"**, **"flip a coin"**, **"roll a d20"**, **"rate me"**, **"predict my future"** / **"what's my fortune"** (magic 8-ball style), and **"good bot"** / **"bad bot"**
- English and Portuguese ("adivinha", "toc toc", "me conta uma piada", "cara ou coroa", "rola um dado"...)
- Pattern-based and deliberately narrow: only short messages that contain her name, so real questions still go to the smart replies. Follows the same switch as her other silly replies (`/config` mention replies)
- The two back-and-forth bits are remembered for 90 seconds in memory only, per person and channel, never stored
- `npm run test-banter` checks it without needing Discord, a database or node-nlp

**Public stats**
- The home page now shows how many servers have Astra and how many people they hold. Only counts, no names or IDs; hidden until the bot has connected
- New `/api/stats` returns the same numbers as JSON (cached for a minute, open to any site), handy for a badge or a tracker later
- If the bot hasn't connected yet when someone loads the page, the numbers are simply retried on the next visit (a "not ready" result is never cached)

**Logo**
- Placeholder logo (a cyan V with a magenta star) on the home page, as the favicon, and as `public/logo.png` (512x512) ready to upload as the bot avatar or a store listing. Replace the files in `src/public/` whenever the real one exists

**Under the hood**
- New `src/public/` folder served as static files; new file `src/commands/banter.js`

---

## b.8.19.0 — Update Channel & Announcements *(current)*
**October 17, 2026**
*Astra now posts her own changelog, one version at a time.*

**Updates channel (off by default)**
- Admins turn it on with `/updates on` and either pick a channel or let her create a read-only `#astra-updates` (`create:True`, needs Manage Channels). Optional `role:` pings a role on every update (`clear_role:True` removes it)
- After each deploy, Astra posts every version that server hasn't seen yet, **one embed per version**, oldest first (no more giant text file). Long versions are split across several embeds
- Each server remembers the last version it was shown, so nothing is posted twice. A server that was offline for a while gets at most the 3 newest, with a note about how many were skipped. Turning updates on never dumps old history: it starts from the current version
- `/updates view` shows the settings, `/updates preview` posts the latest version right now (handy to test the setup, never pings the role), `/updates off` turns it off
- If she can't post (channel deleted, missing permissions) she just retries after the next start
- **Dashboard:** a new **Updates** tab does the same from the website: turn it on, pick the channel and ping role, **Create #astra-updates** in one click, and **Post latest now** to preview

**"Update incoming" warning (bot owner only)**
- `/announce soon` sends an "Update incoming" notice to every server with updates on, with an optional `eta:` and `teaser:`. It follows each server's language and pings that server's role. Only the bot owner can use it (the Discord application's owner, or the IDs in the optional `BOT_OWNER_ID` env var, comma separated)

**Under the hood**
- The text comes from the new `src/changelog.md` (the same content as the changelog; keep headings like `## b.8.19.0 — Title`, oldest first, newest last). Repeated headings are merged and the "upcoming update" placeholder line is ignored
- New columns `updates_enabled`, `updates_channel_id`, `updates_role_id`, `updates_last_version`, created on boot. New file `src/commands/updates.js`
- `npm run test-updates` checks it without Discord, a database or network

**Slash commands without restarts**
- Joining a new server now adds her commands right away (before, they only showed up after her next restart)
- A server where adding commands fails (usually an old invite missing the "applications.commands" permission) is retried every 5 minutes, so re-inviting her is enough, no restart needed
- That server's dashboard shows a warning with a **Re-authorize Astra** button, and opening the dashboard retries immediately

---

{UPCOMING UPDATE, SOON}