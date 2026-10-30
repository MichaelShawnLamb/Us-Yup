# Us Yup — Full-stack social network starter

Us Yup is a responsive social-network starter with a real API and PostgreSQL persistence. It includes:
- Account registration/sign-in and sign-out (password hashes with bcrypt; signed HttpOnly session cookie)
- Editable display name and bio API
- Public member search and follow/unfollow
- Text posts and image/video uploads
- Likes and comments
- One-to-one direct-message API endpoints
- Groups and communities with create/join/leave APIs
- Stories that expire after 24 hours
- Persistent notifications for follows, likes, comments, and messages
- Responsive front end with a modern purple-and-white theme

## Requirements
- Node.js 20+
- PostgreSQL 14+
- A persistent disk for local uploads during development, or replace local uploads with object storage for production

## Run locally
1. Install Node.js and PostgreSQL.
2. Create a database and user, e.g. database `circle`, user `circle_user`.
3. Copy `.env.example` to `.env`, set `DATABASE_URL` and a long random `JWT_SECRET`.
4. Apply the schema:
   ```bash
   psql "$DATABASE_URL" -f schema.sql
   ```
5. Install dependencies and start:
   ```bash
   npm install
   npm start
   ```
6. Visit http://localhost:3000 and create an account.

Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

## API overview
All endpoints return JSON. Protected routes require the session cookie set by login/register.

- `POST /api/auth/register` `{ "username", "displayName", "email", "password" }`
- `POST /api/auth/login` `{ "email", "password" }`
- `POST /api/auth/logout`
- `GET /api/me`
- `PATCH /api/me` `{ "displayName", "bio" }`
- `GET /api/users?q=search`
- `GET /api/users/:id`
- `POST /api/users/:id/follow` toggles follow
- `POST /api/uploads` multipart form field `media`
- `GET /api/posts`
- `POST /api/posts` `{ "body", "mediaUrl"?, "mediaType"? }`
- `POST /api/posts/:id/like` toggles like
- `GET /api/posts/:id/comments`
- `POST /api/posts/:id/comments` `{ "body" }`
- `GET /api/messages/:userId`
- `POST /api/messages/:userId` `{ "body" }`
- `GET /api/health`
- `GET /api/groups`, `POST /api/groups`, `POST /api/groups/:id/join`
- `GET /api/stories`, `POST /api/stories`
- `GET /api/notifications`, `POST /api/notifications/read`

## Before public launch
This is a functional starter, not a fully audited social network. Live video is not implemented yet; it needs WebRTC, signaling, STUN/TURN services, and moderation. Stories, groups, and notifications have backend support and basic UI. The message API is request/response only, not realtime. Do not treat it as launch-ready without the items below:
1. **Hosting and secrets:** use HTTPS, a managed PostgreSQL service, environment secrets, backups, monitoring, and a persistent object store (S3/R2/Supabase Storage) for uploads. Local `/uploads` storage is ephemeral on many hosts and does not scale across instances.
2. **Email verification and recovery:** add verified email, password reset, and account recovery.
3. **Abuse controls:** add rate limits (especially auth, messaging, comments, uploads), spam and bot defenses, reporting/blocking, moderation tools, and an account deletion workflow.
4. **Upload safety:** verify file contents/signatures server-side, scan uploads, strip image metadata, transcode videos, use signed object URLs/CDN, and enforce quotas. The starter checks MIME and file size only; MIME checks alone are not sufficient.
5. **Privacy/security:** consider CSRF defenses appropriate to deployment, strict CORS policy if the frontend is split across origins, security review, audit logs, and privacy/data-retention policies. Cookies are HttpOnly, SameSite=Lax, and Secure in production.
6. **Messaging:** the included direct-message API is polling/request-response only. For realtime delivery add WebSockets/SSE, unread state, conversation list, blocking, and retention controls. It is not end-to-end encrypted.
7. **Product completeness:** add profile screens, friend requests if you want mutual friendships (this starter uses one-way follows), notifications, accessibility checks, tests, pagination, and database migrations.
8. **Operations/legal:** add terms, privacy policy, community guidelines, age-appropriate protections, support/contact path, and a plan for user data requests.

## Deployment
A typical deployment is a Node web service plus managed PostgreSQL. Configure the service's build/start command (`npm install`, `npm start`), add the environment variables from `.env.example`, run `schema.sql` against the production database, set `NODE_ENV=production`, set `TRUST_PROXY=true` only when behind a trusted reverse proxy, and set up persistent object storage before accepting public uploads. Use a platform's persistent disk only if you intentionally want local-file storage.

## Notes
- No third-party tracking or analytics included.
- Demo content is not pre-seeded; the feed is populated by registered users.
- The user interface safely inserts post and comment text as text nodes, rather than interpreting it as HTML.
