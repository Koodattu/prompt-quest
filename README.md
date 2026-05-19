# PromptQuest

Lightweight event feedback and AI prompt-injection challenge demo.

## Run

```bash
docker compose up
```

Frontend: http://localhost:3000  
Backend: http://localhost:4000

Seed passwords:

- Participant: `demo`
- Admin: `admin-demo`

Set `GOOGLE_API_KEY` to use Gemini (`gemini-3-flash-preview` is seeded by default), or set `OPENAI_API_KEY` and switch the provider in the admin panel. Without an API key, the app can use the admin-selectable `mock` provider for local demos.
