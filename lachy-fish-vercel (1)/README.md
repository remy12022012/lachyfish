# Lachy Fish: Vercel deployment

The game is one static page (`public/index.html`) plus six serverless functions in `api/` that power accounts, cloud saves, the global leaderboard, player profiles and the activity feed. Data lives in **Upstash Redis**, the standard persistent store for Vercel (serverless functions cannot keep data in memory between requests).

## Deploy (about 5 minutes)

1. **Create the project.** Either push this folder to a GitHub repo and import it at vercel.com/new, or run `npx vercel` in this folder. Leave every build setting alone; `vercel.json` already sets them (no framework, no build, output `public/`).
2. **Add the database.** In the Vercel dashboard open your project, go to **Storage** (or the Marketplace), add **Upstash for Redis** (the free plan is plenty) and connect it to the project for all environments. This adds the environment variables `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (older integrations name them `KV_REST_API_URL` and `KV_REST_API_TOKEN`; both work). Pick the database region closest to your Vercel functions region.
3. **Set the admin password (optional but recommended).** In the project's **Settings, Environment Variables** add `ADMIN_PASSWORD` with a long random value. It is only ever read on the server and is never put in the page. Without it, `/api/admin` answers 503 and the in-game admin buttons do nothing.
4. **Redeploy.** Environment variables only apply to new deployments: Deployments, then the latest one, then Redeploy (or `npx vercel --prod`).
5. **Check it.** Open `https://YOUR-SITE/api/leaderboard`. You should see `{"rows":[],"total":0,"me":null}`. If you see `The server database is not connected yet.` the variables from step 2 are missing from that deployment.

Then open the game, go to the **Top** tab, sign up, and your account appears on the board. Play on a second device, log in, and **Load cloud save** brings your progress across.

## What the server does

| Endpoint | Purpose |
| --- | --- |
| `POST /api/signup`, `POST /api/login` | Accounts. Passwords are hashed with scrypt; sessions are random 256-bit tokens kept 90 days. |
| `GET /api/me` | Your rank and cloud save. |
| `POST /api/submit` | The game syncs money, income, ascensions, book, best faces and the cloud save (every 30 s while signed in, or **Sync now**). |
| `GET /api/leaderboard?view=peak\|inc\|asc\|book` | Top 50 for each board, your rank, and the activity feed. |
| `GET /api/leaderboard?u=NAME` | A player's profile. |
| `POST /api/admin` | Admin only. Body `{password, action, username}` where action is `kick` (ends every existing session; the player can sign in again), `ban` (blocks sessions and login, removes them from the boards), `unban`, or `reset` (deletes stats and cloud save, keeps the account, removes them from the boards). The password must match `ADMIN_PASSWORD`; wrong passwords are limited to 5 per 15 minutes per IP. |

Protections: strict input validation (invalid numbers are rejected with 422), peak money and ascensions can never go down, ascension jumps are capped, one sync per 5 s per player, login and signup rate limits, constant-time password checks, identical errors for unknown user and wrong password, usernames limited to letters, numbers and `_ . -` (3 to 16 characters). The game runs in the player's browser, so a determined cheater can still fake numbers; the limits stop casual abuse, not a skilled attacker.

If the database is missing on Vercel, the API answers 503 with a clear message instead of silently losing data, and the game keeps working offline with its normal local saves.

### Admin from the game

Tap the small rock in the bottom-left corner of the seabed 5 times quickly (or tap the coin counter 7 times, or press the backtick key 3 times) to open the hidden dev panel. Its **Server admin** section sends kick, ban, unban and reset requests. You type the admin password each time; it is kept in memory only for that request. The panel's client-only cheats are separate, run locally, and switch on a test mode that blocks leaderboard and cloud sync for that device.

## Local development

```
npm install
npm run dev     # http://localhost:3000 with an in-memory store (data resets on restart)
npm test        # API test suite
```

To develop against a real database, export `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` first. `vercel dev` also works.

## Operations

* Moderation: use the admin actions above (in the game's dev panel, or with `curl -X POST https://YOUR-SITE/api/admin -d '{"password":"...","action":"ban","username":"NAME"}'`). For manual work, open the database's Data Browser in Upstash. Keys: `u:<name>` account, `p:<name>` stats, `sv:<name>` cloud save, `lb:peak|inc|asc|book` boards, `feed` activity, `s:<hash>` sessions (value `name|loginTime`), `kick:<name>` and `ban:<name>` moderation markers, `rl:*` rate limits.
* Cost: one sync is about 10 Redis commands, so even a few hundred active players stay inside the free tier.
