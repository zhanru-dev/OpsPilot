# ADR 0001: Build OpsPilot as a Clean-Room Product

- Status: Accepted
- Date: 2026-08-13

## Context

The product direction is informed by prior professional experience and private research into enterprise livestream operations. The portfolio must demonstrate domain understanding without copying proprietary implementation, visual identity, private data or internal contracts.

## Decision

Implement OpsPilot as an original clean-room product:

- OpsPilot is the platform brand; StreamOps is its first vertical.
- Use original domain names, visual design, API paths and relational model.
- Do not copy proprietary source, captured bundles, assets, credentials, private API payloads or page layouts.
- Keep private research outside the public product repository unless it has been rewritten as non-confidential product reasoning.

## Consequences

Positive:

- The ownership claim is clear and defensible.
- Product scope can prioritise portfolio evidence instead of feature parity.
- The architecture starts from current Next.js, NestJS and Prisma conventions.
- Public documentation can describe trade-offs without exposing employer material.

Negative:

- Existing UI and API behaviour cannot be reused as implementation shortcuts.
- Domain assumptions require explicit modelling and validation.
- Some broad legacy capabilities move to later releases.

## Verification

The repository contains no external proprietary branding, copied source tree or captured production API routes. Seed identities and records are fictional. The product strategy explicitly describes the clean-room boundary.
