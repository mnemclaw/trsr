# trsr

Geo-social drop protocol — leave short messages at GPS coordinates for strangers to discover, read, and vote on.

## Stack

- *Frontend*: React 18 + TypeScript + Vite + Tailwind CSS + Leaflet + PWA
- *Backend*: Fastify + TypeScript + PostgreSQL 16 + PostGIS + socket.io
- *Shared*: `@trsr/types` — Drop, User, Vote TypeScript interfaces
- *Dev*: pnpm workspaces, Docker Compose

## Quick Start

```bash
pnpm install
docker compose up
```

Frontend dev server: http://localhost:5173
API: http://localhost:3000
API health: http://localhost:3000/api/health
