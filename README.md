# GitZone

<div align="center">

### Independent Git Hosting & Developer Collaboration Platform

**Built from scratch with security, reliability, and real Git infrastructure in mind.**

</div>

---

## About GitZone

**GitZone** is an independent Git hosting and developer collaboration platform built around real Git infrastructure, secure authentication, repository permissions, and developer workflows.

The goal is not simply to build CRUD around repositories. GitZone is being developed as a real developer platform capable of hosting Git repositories and eventually supporting pull requests, issues, organizations, CI/CD, releases, notifications, and a dedicated CLI.

Development is phase-based: each major layer is implemented, tested, security-audited, runtime-verified, and stabilized before later features depend on it.

---

# Development Status

| Phase    | Name                            | Status   |
| -------- | ------------------------------- | -------- |
| Phase 1  | Core Platform Foundation        | Complete |
| Phase 2  | Authentication & Sessions       | Complete |
| Phase 3  | Repository Core & Git Transport | Complete |
| Phase 4  | Repository Content & Git Data   | Complete |
| Phase 5  | Branch Management               | Complete |
| Phase 6  | Commit History & Diff           | Complete |
| Phase 7  | Pull Requests                   | Complete |
| Phase 8  | Code Review                     | Complete |
| Phase 9  | Issues                          | Complete |
| Phase 10 | Labels & Milestones             | Complete |

---

# Phase 1 — Core Platform Foundation

## Status: ✅ Complete

Phase 1 established the secure runtime and backend foundation used by every later GitZone feature.

### Foundation & Reliability

- Node.js, Express, TypeScript, PostgreSQL, and Prisma
- Environment validation
- Fail-fast configuration
- Database verification before HTTP startup
- Graceful shutdown
- Structured logging
- Unique request IDs
- Centralized error handling
- Production build verification

The server follows a controlled startup lifecycle:

```text
Environment Validation
        ↓
Database Verification
        ↓
Express Startup
        ↓
Process Handlers
        ↓
Server Ready
```

If PostgreSQL is unavailable during startup, GitZone refuses to begin listening instead of running in a partially functional state.

### HTTP Security

Phase 1 established the shared HTTP security boundary:

- Helmet security headers
- Strict configurable CORS
- JSON and URL-encoded body limits
- Controlled malformed JSON responses
- Safe production error responses
- Consistent 404/error contracts
- Configurable reverse-proxy trust
- Minimum JWT secret requirements
- `.env` excluded from version control

Unexpected internal failures are logged server-side while clients receive stable, non-sensitive API errors.

### Health & Reliability

GitZone exposes separate health endpoints:

```http
GET /api/health
GET /api/health/live
GET /api/health/ready
```

`/live` confirms that the application process is alive.

`/ready` performs a real PostgreSQL query to determine whether critical dependencies are available.

Database-outage testing verified that:

- Liveness remains available
- Readiness reports database unavailability
- Fresh startup fails fast while PostgreSQL is unavailable
- Normal operation resumes after PostgreSQL recovery

### Phase 1 Verification

Phase 1 was closed after:

- Source TypeScript checks passed
- Test TypeScript checks passed
- ESLint passed
- Production build passed
- **218 automated tests passed**
- Health/liveness/readiness checks passed
- CORS behavior was verified
- Security headers were verified
- Invalid JSON handling was verified
- Oversized payload rejection was verified
- Database outage behavior was verified
- Fail-fast startup was manually confirmed

> **Phase 1 established a predictable, secure, and testable runtime for GitZone.**

---

# Phase 2 — Authentication & Sessions

## Status: ✅ Complete

Phase 2 built GitZone's authentication, session, token, and account-security layer.

---

## Authentication

GitZone supports:

- User registration
- Email/password login
- bcrypt password hashing
- JWT access tokens
- HTTP-only refresh-token cookies
- Current-user authentication
- Login rate limiting
- Security-action rate limiting

Authentication errors use controlled API responses without exposing unnecessary account information.

---

## Sessions & Refresh Tokens

Sessions are database-backed and include security metadata.

Implemented functionality includes:

- Session creation
- Session validation
- Session listing
- Individual session revocation
- Revoking other sessions
- Logout
- Refresh-token rotation
- Refresh-token hashing
- Token-family tracking
- Refresh-token replay protection

Refresh tokens are not trusted solely because their JWT signature is valid. Server-side session state is also verified.

Replayed or invalidated refresh tokens cannot silently establish another valid authenticated session.

---

## Personal Access Tokens

GitZone supports Personal Access Tokens for API and Git authentication.

PAT security includes:

- GitZone-specific token format
- Cryptographically secure random token material
- SHA-256 server-side token hashing
- Timing-safe verification
- Token creation
- Token listing
- Token revocation

Plaintext Personal Access Tokens are not stored in the database.

---

## TOTP Two-Factor Authentication

Phase 2 includes complete TOTP-based two-factor authentication.

Implemented functionality includes:

- TOTP setup
- QR-code provisioning
- Authenticator application support
- Six-digit verification codes
- Encrypted TOTP secret storage
- Short-lived login challenges
- Challenge expiration
- Challenge attempt limits
- Recovery codes
- Recovery-code login
- One-time recovery-code consumption
- Secure 2FA disable flow
- Rate limiting
- TOTP replay protection

TOTP secrets are encrypted at rest using authenticated encryption.

Recovery codes are generated using cryptographically secure randomness and stored only as hashes.

---

## Two-Factor Login Flow

```text
Email + Password
       ↓
2FA Enabled?
   ┌───┴────┐
   No      Yes
   ↓        ↓
Session   Login Challenge
            ↓
       TOTP / Recovery Code
            ↓
         Verification
            ↓
           Session
```

A user with 2FA enabled does **not** receive an authenticated session immediately after password verification.

Instead, GitZone creates a temporary challenge that must be completed using TOTP or a valid recovery code.

---

## Login Challenge Security

Two-factor login challenges use:

- Cryptographically secure random tokens
- SHA-256 challenge hashes in the database
- Short expiration periods
- Maximum attempt limits
- Atomic challenge consumption
- Replay rejection

A successfully consumed challenge cannot be used again.

---

## Recovery-Code Security

Recovery codes provide a fallback when the authenticator application is unavailable.

GitZone protects recovery codes by:

- Generating high-entropy random codes
- Storing SHA-256 hashes instead of plaintext
- Normalizing submitted codes
- Allowing each recovery code to be consumed only once
- Rejecting previously consumed codes
- Atomically consuming the recovery code and login challenge
- Creating the authenticated session in the same transaction

This ensures that partial database failures cannot leave authentication state inconsistently updated.

---

## TOTP Replay Protection

Phase 2 includes protection against reuse of an already accepted TOTP timestep.

GitZone stores the last successfully accepted TOTP timestep.

Authentication follows:

```text
Valid TOTP
    ↓
Atomic TOTP Step Claim
    ↓
Consume Login Challenge
    ↓
Create Session
    ↓
Commit Transaction
```

The TOTP timestep claim, challenge consumption, and session creation occur inside the same database transaction.

If any later operation fails, the transaction rolls back.

This prevents two separate valid login challenges from successfully reusing the same accepted TOTP timestep.

Real E2E testing confirmed:

```text
Challenge A + TOTP X
        ↓
200 OK

Challenge B + same TOTP X
        ↓
401 INVALID_TWO_FACTOR_CODE
```

---

## Secure 2FA Disable

Disabling two-factor authentication requires:

- An authenticated session
- Current account password
- Valid TOTP code

Successful disablement transactionally removes:

- Two-factor configuration
- Recovery codes
- Outstanding two-factor challenges

After successful disablement, normal password login works without requiring a two-factor challenge.

---

## Phase 2 Security Verification

Phase 2 was verified using:

- Unit tests
- Integration tests
- TypeScript validation
- ESLint
- Production builds
- Prisma validation
- Migration verification
- PostgreSQL state verification
- Postman E2E testing

Verified scenarios include:

- Registration
- Login
- Invalid login
- Current-user authentication
- Access-token validation
- Refresh-token rotation
- Refresh-token replay rejection
- Session listing
- Session revocation
- Logout
- PAT creation
- PAT listing
- PAT verification
- PAT revocation
- 2FA setup
- 2FA verification
- TOTP login challenge
- Invalid TOTP
- Expired challenge
- Used challenge replay
- Challenge maximum attempts
- Recovery-code login
- Recovery-code replay rejection
- 2FA disable
- Invalid password during disable
- Invalid TOTP during disable
- Post-disable normal login
- Transaction rollback behavior
- Same-TOTP replay rejection across separate challenges

The final TOTP replay hardening was committed as:

```text
ef7dac4 fix: prevent two-factor TOTP replay
```

> **Phase 2 established the authentication, session, token, and two-factor security boundary required before GitZone expands deeper into repository hosting.**

---

# Current Repository & Git Foundations

GitZone already contains foundations for repository hosting.

Current functionality includes:

- Repository creation
- Repository management
- Public repositories
- Private repositories
- Repository authorization
- Collaborator management
- READ permissions
- WRITE permissions

---

## Real Git Transport

GitZone uses real Git Smart HTTP infrastructure instead of simulating Git operations through ordinary CRUD endpoints.

The backend uses:

```text
Git
Git Smart HTTP
Bare Git Repositories
git-http-backend
```

Development testing has already included native Git operations such as:

```bash
git clone
git fetch
git pull
git push
```

These repository and Git transport foundations will be audited and hardened during Phase 3.

---

# Phase 3 — Repository Core & Git Transport

## Status: ✅ Complete

Phase 3 established and hardened GitZone's repository management and real Git transport layer.

The original implementation checklist is preserved below for historical reference.

Implemented work includes:

- Repository lifecycle audit
- Repository creation hardening
- Repository update/rename hardening
- Repository deletion hardening
- Bare-repository filesystem safety
- Path traversal protection
- Public/private access enforcement
- Collaborator authorization hardening
- Git Smart HTTP authentication
- PAT-based Git authentication
- Git read/write permission enforcement
- Database/filesystem consistency
- Rollback and compensation handling
- Real Git CLI security testing
- Full repository and Git transport E2E verification

### Target Permission Model

| Actor                        | Read | Push |
| ---------------------------- | ---- | ---- |
| Public anonymous             | ✅   | ❌   |
| Private anonymous            | ❌   | ❌   |
| Repository owner             | ✅   | ✅   |
| READ collaborator            | ✅   | ❌   |
| WRITE collaborator           | ✅   | ✅   |
| Unrelated authenticated user | ❌   | ❌   |

Phase 3 implemented and verified repository permissions through REST API tests and real Git operations.

---

# Technology Stack

## Frontend

```text
React
TypeScript
Vite
SCSS
Redux Toolkit
```

## Backend

```text
Node.js
Express
TypeScript
PostgreSQL
Prisma
```

## Testing & Quality

```text
Vitest
Supertest
TypeScript Compiler
ESLint
Prettier
```

## Git Infrastructure

```text
Git
Git Smart HTTP
Bare Git Repositories
git-http-backend
```

## Planned Infrastructure

```text
Docker
Nginx
Production PostgreSQL
CI/CD
Monitoring
```

---

# Project Structure

```text
gitzone/
├── client/
│   └── React / TypeScript frontend
│
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── errors/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── validations/
│   │   ├── app.ts
│   │   └── server.ts
│   │
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   │
│   ├── prisma/
│   ├── storage/
│   ├── .env.example
│   └── package.json
│
├── docs/
└── README.md
```

GitZone follows a layer-based backend architecture.

Feature-specific files remain focused inside their corresponding layers instead of being grouped into large mixed-purpose modules.

---

# Environment Configuration

Create the backend environment file:

```bash
cd server
cp .env.example .env
```

Important configuration includes:

- PostgreSQL connection
- JWT access secret
- JWT refresh secret
- JWT expiration settings
- Git repository storage path
- CORS configuration
- Request body limits
- Proxy configuration
- Two-factor encryption key

Never commit the real `.env` file.

Security-sensitive values should be generated using a cryptographically secure random generator.

---

# Development

Install dependencies:

```bash
cd server
npm install
```

Start development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Run compiled application:

```bash
npm start
```

---

# Quality Gate

Important backend changes are verified with:

```bash
npm run typecheck
npm run typecheck:tests
npm run lint
npm test
npm run build
npx prisma validate
npx prisma migrate status
```

Security-sensitive functionality is additionally verified through real runtime, database, Postman, or Git CLI testing where appropriate.

---

# Development Principles

## Security First

Authentication, tokens, sessions, permissions, Git authorization, and repository access are treated as security boundaries.

## Fail Fast

Invalid configuration and unavailable critical dependencies should be detected as early as possible.

## Safe Errors

Clients receive stable API contracts while detailed internal failures remain server-side.

## Focused Architecture

Files should have clear responsibilities.

Authentication, login, registration, sessions, 2FA, repository operations, and other features use focused files instead of growing into large mixed-purpose services.

## Test Important Behavior

Tests protect real functionality and security guarantees rather than simply increasing a test counter.

## Real Git Compatibility

GitZone is designed to work with standard Git tooling.

```bash
git clone
git fetch
git pull
git push
```

## Incremental Verification

Major changes follow:

```text
Design
  ↓
Implementation
  ↓
Tests
  ↓
Typecheck
  ↓
Lint
  ↓
Full Test Suite
  ↓
Build
  ↓
Runtime / E2E Verification
  ↓
Commit
  ↓
Push
```

---

# Long-Term Vision

GitZone is intended to grow beyond repository hosting.

```text
Repository Hosting
        ↓
Branches & Commits
        ↓
Pull Requests
        ↓
Code Review
        ↓
Issues
        ↓
Organizations & Teams
        ↓
Notifications
        ↓
Webhooks
        ↓
Releases
        ↓
CI/CD
        ↓
GitZone CLI
        ↓
Production Infrastructure
        ↓
Monitoring & Security Hardening
```

---

# Current Milestone

GitZone backend development progress:

| Phase | Feature                         | Status   |
| ----- | ------------------------------- | -------- |
| 1     | Core Platform Foundation        | Complete |
| 2     | Authentication & Sessions       | Complete |
| 3     | Repository Core & Git Transport | Complete |
| 4     | Repository Content & Git Data   | Complete |
| 5     | Branch Management               | Complete |
| 6     | Commit History & Diff           | Complete |
| 7     | Pull Requests                   | Complete |
| 8     | Code Review                     | Complete |
| 9     | Issues                          | Complete |
| 10    | Labels & Milestones             | Complete |

Phase 10 implementation commit: `db25989`.

See [Phase 10 documentation](docs/phase-10-labels-milestones.md).

---

<div align="center">

## GitZone

**Building a real Git hosting platform from the ground up.**

</div>
