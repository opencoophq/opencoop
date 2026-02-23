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
