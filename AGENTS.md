<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- AP case data lives in a React context (src/lib/erp/store.tsx), seeded from src/data/seed.json and replaced by the Shadow API when reachable — no backend/DB by spec.
- Shadow observer contract (data-shadow-* attributes, window.shadowERP, beforeSave hook) is in src/lib/erp/shadow.ts; every action must await beforeSave before mutating state.
