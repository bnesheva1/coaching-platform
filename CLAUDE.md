# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Next.js version

This project uses **Next.js 16.2.10** with **React 19.2.4**, which is newer than your training data and may include breaking changes to APIs, conventions, and file structure. Before implementing any Next.js feature you're not certain about (routing, data fetching, caching, config options, etc.), check the bundled docs in `node_modules/next/dist/docs/` rather than relying on prior knowledge. Heed any deprecation notices found there.

## Commands

- `npm run dev` — start the dev server (http://localhost:3000) with hot reload
- `npm run build` — production build
- `npm start` — run the production build (requires `build` first)
- `npm run lint` — run ESLint

There is no test setup yet.

## Architecture

This is a freshly scaffolded Next.js **App Router** + TypeScript project (via `create-next-app`), not yet built out. Current structure:

- `app/layout.tsx` — root layout; wraps every route, defines `<html>`/`<body>`, fonts (Geist via `next/font`), and page metadata
- `app/page.tsx` — homepage route (`/`)
- `app/globals.css` — global styles and Tailwind entry point
- Path alias `@/*` maps to the project root (see `tsconfig.json`)

Styling is **Tailwind CSS v4**, configured via `@tailwindcss/postcss` in `postcss.config.mjs` (no separate `tailwind.config.js` — v4 uses CSS-based config in `globals.css`).

As this is a two-sided coaching-consultation booking platform in its earliest stage, expect routing, data models (coaches, clients, bookings), and auth to be added under `app/` following App Router conventions (route segments as folders, `page.tsx`/`layout.tsx`/`route.ts` per segment).
