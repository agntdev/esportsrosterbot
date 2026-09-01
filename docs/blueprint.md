# Esports Tournament Registrar — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

Telegram bot for managing esports team registrations, conflict resolution, and live match tracking. Captains submit rosters with 5 starters + 2 subs, admins resolve ID conflicts and manage match links. Public match tables show team status and results.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Tournament organizers
- Team captains

## Success criteria

- Team registrations with valid rosters
- Resolved ID conflicts via admin
- Publicly visible match table updates

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with team list and match table
- **Register team** (button, actor: user, callback: register:start) — Initiate team registration flow
  - inputs: Team name, 5 starter players (ID + nickname), Up to 2 substitutes
  - outputs: Team confirmation message
- **Edit Team** (button, actor: user, callback: edit:team) — Request roster corrections
  - inputs: Player slot changes
  - outputs: Updated roster confirmation

## Flows

### Team Registration
_Trigger:_ register:start

1. Collect team name
2. Capture 5 required starters
3. Collect optional substitutes
4. Payment collection (if enabled)
5. ID conflict check
6. Admin conflict resolution (if needed)
7. Team confirmation

_Data touched:_ Team, PlayerSlot, RegistrationEntry

### ID Conflict Resolution
_Trigger:_ conflict:detected

1. Notify admin with team IDs
2. Wait for admin choice (1/2)
3. Update conflicting teams

_Data touched:_ Team, PlayerSlot

### Match Management
_Trigger:_ admin:attach_link

1. Admin selects team
2. Attach match link
3. Update match status

_Data touched:_ MatchTable

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Where admin receives conflict reports and payment notifications
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Team** _(retention: persistent)_ — Registered esports team with roster and status
  - fields: name, captain_telegram_id, paid, match_link, status
- **PlayerSlot** _(retention: persistent)_ — Individual player information in a team roster
  - fields: in_game_id, nickname, is_substitute
- **MatchTable** _(retention: persistent)_ — Live tournament standings and match links
  - fields: team_id, status, match_link

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Set registration price
- Approve/resolve ID conflicts
- Attach match links
- Mark match results

## Notifications

- ID conflict reports to admin
- Payment confirmation to captain
- Match link updates in public table

## Permissions & privacy

- Only captain's Telegram ID is stored for contact purposes
- No personal data beyond in-game IDs and nicknames

## Edge cases

- Duplicate in-game IDs across teams
- Incomplete registration forms
- Payment failures when required

## Required tests

- End-to-end team registration with conflict resolution
- Match table updates after admin actions
- Roster editing by captains

## Assumptions

- Default payment flow uses built-in Telegram payments
- Team name defaults to captain username + timestamp when empty
