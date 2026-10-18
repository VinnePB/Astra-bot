# 🛡️ Astra — Changelog

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

## b.8.14.0 — Owner-Only AI Playground *(NOT a public feature)*

- A private sandbox where the **bot owner only** can chat with a real language model (Google Gemini) as Astra, in one chosen test channel. Nobody else's messages are ever sent to it
- Does nothing until `GEMINI_API_KEY` and `ASTRA_OWNER_IDS` are set on the server. Setup in `ai/PLAYGROUND.txt`
- `/config playground channel:#x` (owner only) picks the channel; `reset:True` turns it off
- Short memory (8 turns, RAM only), per-user cooldown, daily cap, replies can never ping anyone
- On any failure she falls back to the normal smart replies / fun lines
- Not tested against the live Gemini API yet
- New database column `ai_playground_channel_id` (added on boot)

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

- The owner-only Gemini playground was **removed** (decided not to use it): no `/config playground`, no `playground.js`. The unused database column stays, harmlessly
- **Fix:** she now detects the language of each message before classifying it, so English questions get English answers (before, the Portuguese model sometimes won on English text). Very short or mixed messages use the server's language
- **Fix:** dashboard autosave toggles (including Smart Replies) now save correctly on Express 5

---

## b.8.15.1 — Updated `/about` and `/quickstart`

- **`/about`** is now a proper explanation of what Astra does (safety & verification, commissions & artists, levels/economy/welcomes, personality & smart replies, for members) plus a 5-step setup tutorial for admins. English and Portuguese
- **`/quickstart`** grew from 5 to 7 steps and now covers language, welcome message, logs, levels, level-role rewards and economy, not just verification and tickets

---

## b.8.15.1 — Rewritten `/about`

- `/about` is now three pages behind buttons: **What she does** (safety, commissions, levels/economy, smart replies), **Setup guide** (a 7-step tutorial: permissions, verification and what each option means, language/welcome/logs, tickets and artists, levels and economy, protection, dashboard) and **For members** (getting in, levels and money, commissions, how to just ask her)
- Everything is in English and Portuguese
- Also written: a short text for the bot's profile "About Me" in the Discord Developer Portal (that one has to be pasted there by hand)

---

## b.8.15.2 — Own domain & `/about` fix
**October 16, 2026**

- The dashboard now lives at **projeckt-v.dev** (www redirects there). HTTPS certificate issued automatically; Discord login works on the new address
- To move: add the domain in Render > Settings > Custom Domains, point the two CNAME records at the service in Cloudflare (DNS only), add `https://projeckt-v.dev/callback` in the Discord Developer Portal, and set `REDIRECT_URI` to the same URL. No code change was needed; the site link Astra shows in Discord is built from `REDIRECT_URI`, so it follows by itself
- **Fix:** the `/about` setup guide no longer says members always type `!verify` in the verify channel. That only applies to the two-step setup (en.json and pt-br.json)

---

## b.8.16.0 — Smarter Smart Replies, round 2
**October 16, 2026**

- **Typo tolerance:** Astra now understands questions with small spelling mistakes ("how do i verfy", "como funcioan o rank") instead of giving up
- **8 new topics:** adding Astra to your own server, what to do about scams and phishing, troubleshooting when the bot isn't responding, commission prices and wait times, "no permission" errors, and tips for gaining XP faster
- **Follow-up questions:** for a few minutes after answering, she remembers the topic, so "tell me more" or "não entendi" gets a different explanation of the same thing
- **Dashboard link in answers:** setup and invite answers now point to the website directly

---

## b.8.17.0 — Economy, Part 2: Random Events, Shop & Gambling
**October 17, 2026**
*The currency finally has something to do.*

**Random events (off by default)**
- While people chat, Astra occasionally drops a button in the channel. A **coin drop** goes to the first person to click (usually 25–150 coins, with a rare golden pouch worth 500–1500). A **coin rain** lasts 45 seconds and everyone can catch some
- Events respect a minimum interval (45 minutes by default) and only happen when at least two people are chatting, so quiet servers aren't spammed. Requires the economy to be on
- Turn them on with `/shopconfig events` or in Dashboard → Economy → Random Events
- Simultaneous clicks are handled fairly: one drop, one winner

**Shop**
- `/shop` shows what's for sale and `/buy` purchases it
- **Cosmetic roles:** admins can sell roles with `/shopconfig add-role` or from the dashboard. Roles with powerful permissions, roles above Astra's, and integration roles can't be sold. If a role can't be given, the purchase is refunded automatically
- **Five fun items, no setup needed:** **Town crier** (Astra announces your message), **Get roasted**, **Get hyped**, **Fake ban** (clearly a joke) and a **Mystery box** with a random payout
- `/shopconfig view` lists items and event settings; `/shopconfig remove` takes an item off sale (members keep roles they already bought)

**Gambling**
- `/gamble` flips a coin: win and your bet doubles. Up to 1000 per bet, with a short cooldown. The odds slightly favor the house

**Also**
- `/help`, `/about`, `/quickstart` and the dashboard cover the new commands, in English and Portuguese
- Smart replies can now answer questions about the shop, random events and gambling

---

## b.8.18.0 — Banter, Public Stats & a Logo
**October 17, 2026**
*She joins in on the dumb stuff now.*

**Banter**
- Say her name and try **"guess what?"**, **"knock knock"**, **"tell me a joke"**, **"flip a coin"**, **"roll a d20"**, **"rate me"**, **"predict my future"**, or **"good bot"** / **"bad bot"**. Works in English and Portuguese
- Works even with smart replies off, and follows the same on/off switch as her other playful replies (`/config` → mention replies)

**Public stats**
- The website's home page now shows how many servers use Astra and how many people they reach

**Logo**
- Astra has a (placeholder) logo, shown on the website and as the browser tab icon

---

## b.8.19.0 — Update Channel & Announcements
**October 17, 2026**
*Astra now posts her own changelog, one version at a time.*

**Updates channel (off by default)**
- Admins can turn it on with `/updates on`, either in an existing channel or by letting Astra create a read-only `#astra-updates`. A role can optionally be pinged on each update
- After every update, Astra posts what's new in that channel, one post per version
- Nothing is ever posted twice, and turning it on doesn't flood the channel with old history
- `/updates view` shows the settings, `/updates preview` posts the latest version so you can see how it looks, and `/updates off` turns it off
- Everything is also available in the new **Updates** tab on the dashboard, including one-click channel creation

**Update notices**
- Servers with the updates channel on now get a heads-up before a new update arrives

**Slash commands**
- When Astra joins a new server, her commands are available right away
- If her commands are missing from a server (usually because she was added with an old invite link), the dashboard now shows a **Re-authorize Astra** button. After re-authorizing, the commands appear within a few minutes

---

## b.8.19.1 — Smarter Replies, Tuned
**October 17, 2026**
*First round of tuning based on real accuracy measurements.*

- Astra now understands more ways of asking about levels, XP, verification, commissions, artists, the leaderboard and turning features on, in English and Portuguese
- Fixed a few cases where she confidently answered the wrong topic, such as "como eu faço pra subir de nível" getting a reply about being bored
- Better at recognizing scam reports ("someone keeps asking for my login code") and "the bot stopped answering me"
- Typos are now corrected even when she thinks she already understood, so a misspelling can no longer lead her to the wrong answer

---

## b.8.19.2 — Security Hardening
**October 17, 2026**
*A full security review of the website and bot, with fixes for everything it found.*

**Website & dashboard**
- Login is now protected against forged and hijacked sign-ins, and every login starts a fresh session
- Dashboard changes can only be made from the dashboard itself, which blocks requests sent from other websites
- Access is re-checked regularly: if you lose Administrator on a server (or leave it), the dashboard for that server closes within minutes instead of staying open
- Added standard browser protections against clickjacking and content sniffing, plus rate limiting against automated abuse
- Channel and role choices are now verified to belong to your server before they are saved
- The language toggle can no longer redirect anywhere outside the site

**Roles**
- People with an Astra-authorized role (but not Administrator) can no longer set Astra to hand out powerful roles, such as ones that manage roles, messages or members, through verification or level rewards. Server Administrators are not affected

**Economy**
- `/daily` and `/pay` are now fully protected against being triggered several times at once, so coins can no longer be duplicated

---

## b.8.19.3 — Support Page
**October 17, 2026**
*A page for people who want to support Astra, and a note about how she was built.*

- New **Support Astra** page, available in English and Portuguese, with a link to the project's Ko-fi. Supporting is completely optional and every feature stays free
- A footer on the homepage now links to the support page and credits Claude (Anthropic) for helping develop Astra
- The page also explains that Astra's smart replies run inside the bot itself, so messages are never sent to an AI company

---

## b.8.20.0 — Moderation Tools
**October 17, 2026**
*Astra can now help moderate your server.*

**New commands**
- `/ban`, `/kick` and `/timeout` for removing or muting members, with an optional reason that is logged and sent to the member
- `/warn` with a full warning history. Enough warnings trigger an automatic punishment: a timeout by default after 3 warnings, with optional automatic kick and ban limits
- `/clear` to quickly delete recent messages in a channel, optionally only from one person
- `/mod` for the rest: unban, remove a timeout, view or clear a member's warnings, set slowmode, and lock or unlock a channel
- `/mod settings` to choose a moderation log channel and set the automatic punishment limits. Every action is recorded as a numbered case

**Safety**
- Moderators need the matching Discord permission (for example Ban Members to ban). Astra-authorized roles alone can't be used to ban or kick
- Nobody can punish themselves, the server owner, Astra, or someone whose top role is equal to or above their own
- If Astra's role is too low or she lacks a permission, she explains exactly what to change instead of failing silently

**Dashboard**
- The server list now shows how much of Astra is set up on each server, as a percentage
- Added Home and Support links to the dashboard menu

**Note:** Astra's invite link now includes the Ban Members and Moderate Members permissions. Servers that added her earlier can grant them in Server Settings, under Roles

---

## b.8.20.1 — Privacy & Terms
**October 17, 2026**
*Clear rules about your data, and automatic cleanup.*

- New **Privacy Policy** and **Terms of Service** pages, in English and Portuguese, linked from the footer of the website. They explain what Astra stores, why, and your rights
- When Astra is removed from a server, that server's data is now deleted automatically after 30 days. Adding her back within that time restores everything
- Astra still never stores the content of messages, and her smart replies still run inside the bot, with nothing sent to an AI company

---

## b.8.21.0 — Reliability & Your Data
**October 17, 2026**
*Safer operations behind the scenes, and more control over your own data.*

**Your data**
- New `/mydata view` command: a private file with everything Astra stores about you
- New `/mydata delete` command: deletes your levels, coins, tickets and artist profile in every server, after a confirmation. Moderation records are kept as part of each server's safety record
- The Privacy Policy now covers backups and these new commands

**Reliability**
- Astra now sends the developer an alert if she crashes, hits an error or loses her connection to Discord, so problems get fixed before members notice
- Daily private backups of Astra's data, so a database problem can no longer mean starting over
- A public status check for uptime monitoring

**Server safety**
- The developer can now review the servers Astra is in and remove her, or permanently block a server, if its use breaks the Terms of Service. The server owner is told why
- Blocked servers can't add Astra again

---

## b.8.22.0 — Roles, Help & Updates *(current)*
**October 17, 2026**
*A clearer role structure for your server, a tidier help menu, and a more flexible updates channel.*

**Roles**
- New role hierarchy: Owner, Astra Admin, Moderator and Verified member. Astra can create the Astra Admin, Moderator and Verified roles if your server doesn't have them yet. Moderator only carries ban, kick, timeout and message-management permissions
- Verified members can now use Astra's everyday commands (rank, daily, shop and the rest). Until verification is set up, these stay open to everyone
- Optional divider roles (STAFF, ACCESS, LEVELS and SPECIAL) that Astra creates, places in order and keeps in sync for every member, now and as roles change
- Choose which roles each divider heads, right from the dashboard, and pick the look: a line or a wide bar
- Dividers can be given to every member from the moment they join
- A "Check everyone now" button re-checks every member's divider roles and positions, only when you ask for it
- The same button also tidies the roles under each divider, so every group stays together (never touching staff, powerful or integration roles)
- Wide bars are now capped so they always fit a profile card, and every divider ends up about the same width
- Registering an artist now also gives them the server's artist role, and removing them takes it back
- None of these roles carry moderation powers

**Artists**
- Artists can now edit their own commission panel on the website: terms, won't-do list, pricing, banner and links, with a live preview of how it looks in Discord
- Each artist only sees and edits their own panel

**Help**
- `/help` is now split into sections you pick from a menu, and each person only sees the sections that apply to them
- New section about your data and privacy

**Updates channel**
- Announcement channels can now be used for updates, and the dashboard shows which channels Astra can't post in yet
- For private channels, Astra now tries to give herself access, and tells you what to change if Discord doesn't allow it

**Other**
- The dashboard now keeps your place after saving: you stay on the same tab and scroll position instead of jumping back to the top
- The server list on the website now shows your role in each server (Owner, Admin or Member), and servers where you can't configure Astra are listed as "No permission to configure"
- The welcome notice in the rules channel now follows the server's language
- `/owner` now lives only in direct messages with Astra

---