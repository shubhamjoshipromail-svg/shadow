# Deploy (Railway, US West)

One project, three pieces:

| Service | Source | Settings |
|---|---|---|
| `core` | repo root | `RAILWAY_DOCKERFILE_PATH=deploy/core.Dockerfile`; healthcheck `/health`; region `us-west2` |
| `Postgres` | Railway plugin | same region; `DATABASE_URL` referenced into `core` |
| `erp` (demo workplace) | repo root | Node; build `npm run build` with `NITRO_PRESET=node-server`; start `node .output/server/index.mjs`; `VITE_SHADOW_API=https://<core domain>` |

`core` variables you set yourself (never committed): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`.
Also: `SHADOW_PUBLIC_URL=https://<core domain>`, `SHADOW_ERP_URL=https://<erp domain>`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
Then point the ElevenLabs agents at the core domain: `cd backend && .venv/bin/python scripts/setup_elevenlabs.py --public-url https://<core domain>`.

Latency: the voice turn is ElevenLabs → `core /v1/chat/completions` → template reply in ~0.2 s (LLM work is in the
background), so one region close to the users and to ElevenLabs' US edge is enough. Sessions live in memory: a redeploy
ends live sessions; saved Work Maps, the decision ledger and receipts are in Postgres and survive.
