# Repository Guide

## Scope

This repository is a Node.js 20+ Telegram check-in service. It intentionally contains no monitoring, forwarding, generic automation, Python runtime, or Docker deployment surface.

## Runtime

- Production entry: `node bootstrap.js` (`npm start` runs the same command).
- Interactive Telegram login: `npm run login`.
- The bootstrap checks Node.js and production dependencies, and runs `npm install --omit=dev` when dependencies are missing.
- Web UI and API listen on `HOST` / `PORT` (`0.0.0.0:8000` by default).
- The Node process serves HTTP/HTTPS directly; there is no reverse-proxy deployment surface.
- Public binding requires `TG_AUTH_TOKEN` (`AUTH_TOKEN` is accepted as an alias).
- Check-in configs live at `<TG_WORKDIR>/signs/<task>/config.json`.
- A locally generated Telegram session lives at `<TG_WORKDIR>/session.txt`.
- Web-managed runtime settings live at `<TG_WORKDIR>/settings.json`.
- AI uses `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and `OPENAI_MODEL`.

## Key Files

- `bootstrap.js`: root production entry.
- `server/bootstrap.js`: runtime/dependency self-check.
- `server/index.js`: Express API, static UI, and scheduler integration.
- `server/checkin.js`: Telegram action executor.
- `server/ai.js`: AI image selection and calculation helpers.
- `server/config.js`: config validation and persistence.
- `server/scheduler.js`: cron schedule lifecycle.
- `server/security.js`: HTTP/HTTPS security-header options.
- `server/settings.js`: runtime settings persistence and secret-safe public view.
- `server/telegram-auth.js`: shared Web/CLI Telegram login state machine.
- `public/`: unified dashboard for overview, Telegram login, tasks, history, and settings.
- `test/`: Node built-in test runner suite.

## Development

Run before submission:

```bash
npm run lint
npm test
```

Do not commit `.env`, session strings, `.signer`, or `node_modules`. Keep user-facing documentation in Simplified Chinese unless requested otherwise.
