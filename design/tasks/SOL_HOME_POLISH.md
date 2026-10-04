# Sol task: Home + landing polish (owner feedback, 2026-10-04)

Repo root: /Users/shubhamjoshi/Hacknation 2. Product Tacet, apprentice Mira. Read `design/DESIGN.md`, `console/src/pages/Home.tsx`,
`console/src/components/Mira.tsx`, `site/index.html`, and the API in `backend/shadow/main.py` (sessions, workflows, experts).
Live: https://tacet.up.railway.app (landing) and /app (console). Keep the design system exactly (paper, Newsreader titles,
Geist, IBM Plex Mono labels, 1px rules, no cards/gradients/shadows/emoji).

You own: `console/src/pages/Home.tsx`, `console/src/components/*` (new files ok), `site/index.html`, `site/privacy.html`.
Don't touch backend python unless strictly needed (then add a test). Never use port 8000. No git commits.

1. **Contact actually works.** "Talk to us" and both "Run a pilot on one workflow" buttons are `mailto:` links, which do
   nothing for people without a desktop mail app (most Gmail users). Replace with a small, accessible contact popover/panel in
   the site's style: shows `shubhamjoshipro.mail@gmail.com` in mono, a **Copy** button (with "Copied" state), **Open in Gmail**
   (`https://mail.google.com/mail/?view=cm&fs=1&to=shubhamjoshipro.mail@gmail.com&su=Tacet%20%E2%80%94%20pilot%20for%20our%20team`,
   new tab), and the plain `mailto:` link as a fallback. Escape/click-outside closes it. All three buttons open it.
   The two "Run a pilot" buttons: keep ONE (in the "Who it's for" section) and remove the duplicate near the bottom
   (or make the bottom one "Talk to us"). Also the privacy page contact.
2. **New-workflow panel gets a learning Mira on the right** (`Mira` component, the apprentice with the notebook, like
   the "Learn from an expert" job). Balanced two-column layout on desktop; stacked on mobile.
3. **Workflow picker = two examples + new.** Always show:
   - **Accounts payable – supplier invoices** (built in, already taught by Sabine; keep it the default selection).
   - **Support desk – ticket triage** (example), even before anyone has taught it on live. If no learned support workflow
     exists yet, selecting it shows the cold-start state: "Mira hasn't learned this yet. Show her: open the Support desk"
     (button → `https://erp-production-e3b0.up.railway.app/support?tacet=learn`), with Teach disabled. Once a learned
     workflow whose name/signature matches the support desk exists (from `/api/workflows`: path `/support/:id` in its
     signature), select that one instead and both jobs work.
   - Any other learned workflows.
   - **+ New workflow** (the panel above).
4. **The process-owner block: each entry is clickable as a whole** (the entire block is the link target, with hover state).
   **Work Map must always open**: today it says "Opens from a live session" because MapPage needs an in-memory session.
   On click, if no live session with that expert's map exists, create one from the saved map
   (`POST /api/sessions {mode:"capture", pack, expert:<expert with the richest map>, fresh:false}`; knowledge accumulates,
   so this continues the saved map without changing it) and navigate to `/s/<sid>/map`. Same idea for "What an agent may do
   alone": go to the latest certification if one exists; otherwise create/continue a session the same way and open
   `/s/<sid>/proof` with the agent link visible. "Where experts differ" already works; make the whole block clickable.
5. Verify: `cd console && npx tsc --noEmit -p . && npm run build`. Run the console dev server against the LIVE API for
   viewing; you may click the process-owner entries once each on live to verify they open (they create one capture
   session from the saved map, which is fine), but do NOT start learning or label anything. Serve `site/` locally
   (e.g. `python3 -m http.server 8093 -d site`) to test the contact panel. Screenshot to `design/tasks/shots/sol-home-*.png`,
   look critically, iterate. Write a short report to `design/tasks/SOL_HOME_POLISH_REPORT.md`.
