# 0002: v0.1 is local only

- Status: accepted
- Date: 2026-10-19

## Context

An earlier StayOn prototype (a Cursor extension) used a hosted backend and a paid
survey provider. The Claude Code Mod is a fresh start that should be installable
by anyone in one line and trustworthy by default.

## Decision

v0.1 makes no network calls, needs no sign-in, and depends on no backend,
survey or payment provider. It does not depend on the legacy prototype's code.

## Consequences

- Nothing about the user's prompts, code or tasks leaves their machine.
- Earn/rewards features need a separate, server-verified design later.
