# Lessons Learned

## 2026-02-23: Multi-file renames require upfront inventory

**Context:** Renamed pricing tiers from Starter/Growth to Essentials/Professional across the codebase.

**Mistake:** Edited the obvious files (pricing page, EN/NL translations, backend DTO) first, then discovered FR/DE translations and the onboarding page in a post-hoc sweep. Should have done a codebase-wide grep for all references _before_ starting edits.

**Rule:** For any rename or multi-file refactor, always run a full codebase search first and build the complete file list before touching anything. Use a `tasks/todo.md` checklist for 4+ files.

---

## 2026-02-23: Always run build verification before committing

**Context:** Committed pricing and logo changes without running `pnpm build`.

**Mistake:** Skipped the verification step. Got lucky that it compiled, but should have caught this before pushing to prod.

**Rule:** Before any commit that touches multiple files or changes types/interfaces, run `pnpm build` and confirm it passes. No exceptions.

---

## 2026-02-23: Apply workflow rules consistently, not selectively

**Context:** User called out that workflow orchestration rules (plan mode, task tracking, verification) were not being followed despite being in CLAUDE.md.

**Mistake:** Treated the rules as optional for "simple" tasks, but the pricing change (8 files, 4 languages, backend DTO) was not simple.

**Rule:** The threshold for plan mode is 3+ files or any architectural decision. If in doubt, use plan mode. The cost of a 30-second checklist is always less than missing a file.

---

## 2026-04-14: TypeScript accepting an API ≠ runtime support

**Context:** Built a new `[meetingId]/edit/page.tsx` route for the AGM feature. Used `use(params)` to unwrap the `Promise<{ meetingId: string }>` that Next.js 14+ passes to dynamic pages. Typecheck passed. Production build passed. Runtime: white page + "Application error: a client-side exception has occurred".

**Mistake:** `use()` is exported from React 18 but only functions correctly in React 19. The project runs Next.js 14 + React 18 — every sibling page uses `useParams()` from `next/navigation`. I chose the newer API without checking what neighbouring files do.

Code review (both automated agent + my own sanity check) missed it because both reviews focused on business-logic / security / spec compliance. Neither specifically checked "does this use React/Next.js APIs that match the project's installed versions?"

**Rule:**
1. When creating a new file in an established route tree, **start by reading a sibling file in the same tree** and match its import style + data-fetching + param-handling patterns. Don't freshly choose an API.
2. For any new route page, include `grep` for `useParams\|use(params\|params:` in the same tree and mirror the majority pattern.
3. When reviewing PRs that add frontend routes, explicitly check: does the new code use framework APIs consistent with sibling files? TypeScript compilation and `next build` success are not sufficient evidence — runtime behaviour of React features depends on the installed React major version, which the type system cannot enforce.
4. If the project has Playwright E2E tests, any new route should at minimum have a smoke test that renders the page. This would have caught it before merge.
