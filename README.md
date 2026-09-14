# Astra ( a Discord BOT )
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

## b.6.0.0 — Rebrand, Localization & Polish *(current)*
**September 2, 2026**
*Astra, properly finished — for now.*

- Rebranded from "Astra Security" to just **Astra** across every surface, bot and web
- Every page has its own browser title now instead of one generic one everywhere
- Fixed a real setup bug: saving verification/ticket config on the website now actually posts the panel messages to Discord — used to still require running the Discord command afterward
- Added bilingual support: **English** (default) and **Português (Brasil)**, configurable per server via `/config language`, plus a language toggle on the website
- Rebuilt the homepage: it detects if I'm logged in, shows a "Hello, [name]" menu with quick Dashboard/Logout access, or a Login button if not
- Added join/leave logging and a live member count on the dashboard