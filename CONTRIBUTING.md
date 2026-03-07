# Contributing to Radiology AI Assistant

Thank you for your interest in contributing to this project. This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [License](#license)

---

## Code of Conduct

By participating in this project, you agree to maintain a respectful and constructive environment. We expect all contributors to:

- Be respectful and inclusive in all interactions
- Provide constructive feedback
- Focus on what is best for the project and its users
- Accept responsibility for mistakes and learn from them

---

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally.
3. Create a new branch from `main` for your work.
4. Make your changes, following the coding standards below.
5. Test your changes thoroughly.
6. Push your branch and open a pull request.

---

## How to Contribute

### Reporting Bugs

- Search existing issues to avoid duplicates.
- Use the bug report template if available.
- Include steps to reproduce, expected behavior, and actual behavior.
- Include your environment details (OS, Node.js version, database version).

### Suggesting Features

- Open an issue with the "feature request" label.
- Describe the use case and why the feature would be valuable.
- Be specific about the expected behavior.

### Submitting Code

- Fix bugs, implement features, or improve documentation.
- Follow the pull request process described below.
- Ensure all tests pass before submitting.

### Improving Documentation

- Fix typos, clarify explanations, add examples.
- Documentation changes are welcome and appreciated.

---

## Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ with pgvector extension (or Docker)
- npm or pnpm

### Setup Steps

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/radiology-ai-assistant.git
cd radiology-ai-assistant

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env.local

# Set up database
docker-compose up -d
npm run db:generate
npm run db:push

# Start development server
npm run dev
```

---

## Coding Standards

### General Principles

- **Explicit over clever** -- Prefer readable, straightforward code over clever abstractions.
- **Comments explain "why", not "what"** -- Code should be self-documenting.
- **Validate at boundaries** -- Use Zod schemas at API layers.
- **Fail fast on PHI** -- Block protected health information before processing, not after.
- **Type everything** -- Leverage TypeScript and Prisma generated types.
- **Mobile-first CSS** -- Default styles for mobile, use `md:` breakpoints for desktop.

### File Naming

| Type | Convention | Example |
|------|-----------|---------|
| React components | PascalCase | `ChatMessage.tsx` |
| Pages (App Router) | lowercase `page.tsx` | `app/(dashboard)/chat/page.tsx` |
| tRPC routers | kebab-case | `routers/message.ts` |
| API lib modules | kebab-case | `lib/rag-config.ts` |
| Scripts | kebab-case | `scripts/ingest-folder.ts` |
| Utilities | kebab-case | `lib/utils.ts` |
| Stores | kebab-case | `stores/auth.ts` |
| Hooks | camelCase | `hooks/useRealtime.ts` |

### TypeScript

- Use strict mode.
- Avoid `any` types; use `unknown` when the type is genuinely unknown.
- Export Zod schemas for all API inputs.
- Use Prisma generated types for database models.

### React / Next.js

- Use `"use client"` directive only when necessary (hooks, event handlers, browser APIs).
- Use existing shadcn/ui components from `@/components/ui/` before creating new ones.
- Use Lucide React for icons.
- Follow the App Router conventions (page.tsx, layout.tsx, route.ts).

### PHI Compliance

Any code that handles user-generated text MUST:

1. Call `detectPotentialPHI()` on the input.
2. Block submission if unresolved PHI spans are detected.
3. Log the detection event via `PHIDetectionLog` (hash only, never raw PHI).
4. Support per-span override workflow when appropriate.

### Database

- Use Prisma for standard queries.
- Use raw SQL (`$queryRaw`) for pgvector operations (Prisma does not support pgvector natively).
- Always include `institution` field on Document and DocumentChunk records.

---

## Pull Request Process

1. **Branch naming**: Use descriptive branch names (`fix/phi-detection-edge-case`, `feature/new-category-support`, `docs/update-setup-guide`).

2. **Commit messages**: Write clear, descriptive commit messages that explain the "why" behind changes.

3. **PR description**: Include:
   - Summary of changes
   - Motivation and context
   - How to test the changes
   - Screenshots for UI changes

4. **Testing checklist** (verify before submitting):
   - [ ] PHI detection still blocks core identifiers (MRN, SSN, DOB, NAME)
   - [ ] tRPC mutations validate input with Zod schemas
   - [ ] Protected procedures check user authorization
   - [ ] Mobile layout works (test at 375px width)
   - [ ] RAG citations include source documents
   - [ ] Emergency detection triggers on clinical urgency keywords
   - [ ] Institution filter correctly limits results

5. **Review process**:
   - All PRs require at least one review before merging.
   - Address all review comments before requesting re-review.
   - Squash commits when merging to keep history clean.

---

## Reporting Issues

When reporting issues, please include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Environment details (OS, Node.js version, browser)
- Relevant log output or error messages
- Screenshots if applicable

For security vulnerabilities, please see [SECURITY.md](SECURITY.md) instead of opening a public issue.

---

## License

By contributing to this project, you agree that your contributions will be governed by the same terms as the rest of the project.
