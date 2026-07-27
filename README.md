# court-queue-app

Monorepo scaffold for Court Queue App (React + Vite frontend, Express + Socket.IO backend, PostgreSQL). This is a minimal starter to get you up and running.

Quick start

1. Configure Postgres and set `DATABASE_URL` in `server/.env` or system env.
2. Install dependencies for server and client:

```bash
cd server
npm install
cd ../client
npm install
```

3. Start server and client in separate terminals:

Server
```bash
cd server
npm run dev
```

Client
```bash
cd client
npm run dev
```

What you get
- Express API with Socket.IO for realtime queue updates
- React + Vite frontend with Tailwind CSS and realtime updates via Socket.IO

Next steps
- Add DB migrations and persist queues in PostgreSQL
- Add authentication and user/session support
- Add court management UI
