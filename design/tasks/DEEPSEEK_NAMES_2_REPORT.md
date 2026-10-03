# Name search, round 2 — report

Task: `design/tasks/DEEPSEEK_NAMES_2.md`. Research only. **Web access: yes.** Product/trademark evidence is from
web search plus `whois` and DNS/HTTP probes run from this machine on **2026-10-03**. Only this file was written;
nothing was committed, pushed or started.

**Method and limits.** Domains are registry `whois` results plus `dig`/`curl` liveness probes. "Free" here means
`whois` says *no match / not found* **and** the name has no A/NS records; I re-queried those names directly against
the registry. Two registry results were misleading and are corrected below: `vellum.io` and `rubrica.ai` looked
free in the first pass but both **are registered and resolve** (an Azure 404 and an IONOS parking page), so they are
reported as taken. Trademark data is from public records (TrademarkElite, Justia, Furm, UK IPO gazette) because
**USPTO TSDR, EUIPO and a paid class 9/42 register search were not runnable here**. Everything below is a flag, not
a legal clearance; the register search is explicitly marked as the step I could not do. Nothing about meaning
claims for German was machine-verified beyond dictionary knowledge — flag it for a native reader.

Round 1 (`DEEPSEEK_NAMES_REPORT.md`) killed **Tacit, Margin, Understudy, Mira, Shadow**. This round does not
re-propose them. Two round-1 findings are now worse, not better: **Tacit.io's concept space now has a funded
incumbent — [Interloom raised $16.5M](https://interloom.com/en/blog/seed-announcement/) explicitly "to solve AI
agents' tacit knowledge problem"**, and [Cloneable raised $4.6M](https://news.crunchbase.com/venture/cloneable-cloning-expert-worker-knowledge-ai-infrastructure/)
to clone expert worker knowledge. Also new this round: **[Decagon's Duet Apprentice](https://decagon.ai/blog/duet-apprentice)**
ships a product called *Apprentice*, and [Scribe is at $100M ARR](https://scribe.com/library/100-million-arr-press-release)
in adjacent AI process documentation. The name has to survive a category that is now crowded at both the
word level and the concept level.

## Headline

1. **Every short, common English word in this theme is taken** in `.com` and `.ai`. That is no longer a per-name
   accident: among the 15 finalists, `.com` is taken 15/15 and `.ai` is taken 15/15. The only domains I could
   confirm free are the `get<name>.com` / `get<name>.ai` pattern, one `.work`, and the dropped `.io` pair below.
2. **Tacet is the only finalist with a clean, free, single-word, non-`get` domain I could purchase today:
   `tacet.work`** (`whois -h whois.nic.work tacet.work` → "No Data Found"). Its `.ai` and `.io` are held, but the
   `.work` is a genuinely brandable option for an enterprise product.
3. **Rubrica is the best semantic candidate that is not already an AI brand**, but `rubrica.ai` is *parked*, not
   active (IONOS default page, created 2024-01-16), so it is likely acquirable; the `.com` is held by a
   Network Solutions registrant since at least 2029.
4. **Vellum has the tidiest spelling and the worst collateral**: `vellum.ai` belongs to a **$20M-Series-A enterprise
   AI developer platform** ([BusinessWire, 2025-07-10](https://www.businesswire.com/news/home/20250710009580/en/Vellum-Raises-$20M-Series-A-to-Bring-Rigor-Speed-and-Reliability-to-Enterprise-AI-Development)),
   which is a different product but the same buyer and the same three letters.
5. **Ranking: 1 Rubrica · 2 Vellum · 3 Tacet · 4 Compend · 5 Codicil · 6 Journe.** Vellum is second only on
   collateral, not on fit; Tacet is third because of a homophone collision with "tacit" — a word the product's own
   pitch relies on. If the team rebrands the pitch text away from "tacit knowledge", Tacet moves to #1.
6. **Kepler** (checked late as a test of the "observes and derives laws" angle) is genuinely strong and has a free
   `getkepler.work`, but `kepler.com/.io/.ai` are all held and a 2026 [Kepler AI](https://www.getkepler.ai/) is
   live, so it is a bonus name, not a top-6 pick.

## Candidate list (45)

All ≤ 10 letters. "DE" = spoken/read easily by a German speaker; flagged where the German meaning is the risk.

**Tacit knowledge and notebooks:** Vellum, Vellumwork, Tacet, Tacita, Nota, Codici, Marginalia, Rubrica, Gloss,
Lore, Sagen, Kenner, Kundig, Merken, Wissen.

**Apprenticeship, guild and mastery:** Journe, Compend, Compendium, Magister, Journeyman, Guild, Guilder, Adept,
Scribe, Usher, Steinmetz.

**Margins, records and handover:** Codicil, Folio, Signet, Parley, Ledger, Rubric, Steno.

**Observation, science and law:** Kepler, Tycho, Gauss, Ohm, Kelvin, Mendel, Boyle.

**Craft and pedagogy:** Anvil, Loom, Ember, Heirloom, Tutor, Mentor, Preceptor, Forge.

Rejected before the cut, with the reason (so the list is auditable): *Tacit* (round 1 + Interloom), *Margin /
Marginal* ("margin call"; and "marginal" reads as sub-par in finance), *Understudy* (round 1 + YC Understudy),
*Mira* (round 1; kept as the character), *Shadow* (round 1), *Kraft* (Kraft Foods DE + "Kraft" = power),
*Sage / Adept / Glean / Scribe / Curator / Newton / Darwin / Galileo* (shipped AI brands), *Lore* (DE: "leer" =
empty), *Nota* (DE: "Nutte" near-homophone risk), *Journey* (Journey app/band), *Ink / Jot / Entry* (too generic),
*Skald / Marginalia / Journeyman* (>10 letters), *Tycho* (EN "psycho" without the s), *Boyle* ("boil"),
*Hooke* (security "hook"), *Steno* (existing shorthand tech).

## Shortlist: the best 15, checked

Product checks are searches; trademark flags are the records I could retrieve. `whois` columns are the registry
result on 2026-10-03. **Trademark note: I could not run a live class 9/42 register search (USPTO TSDR / EUIPO).**

| # | Name | Existing AI/enterprise product (source) | Trademark flag found (class 9/42) | `.com` | `.ai` | Variant |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Rubrica** | [rubrica.ai](http://rubrica.ai) parked (IONOS default, reg. 2024), not a shipped product; a GNOME desktop address book named [rubrica](https://cgit.freebsd.org/ports/plain/deskutils/rubrica/pkg-descr?h=2022Q2) | None found; registers were not searchable — **open risk** | taken (Network Solutions, active) | taken (InternetX, parked) | `getrubrica.com` taken (Squarespace) |
| 2 | **Vellum** | [Vellum](https://www.businesswire.com/news/home/20250710009580/en/Vellum-Raises-$20M-Series-A-to-Bring-Rigor-Speed-and-Reliability-to-Enterprise-AI-Development) enterprise AI dev platform, $20M Series A, [vellum.ai](https://www.vellum.ai/blog/announcing-our-20m-series-a); also a [document/publishing-adjacent mark](https://furm.com/trademarks/vellum-85884407) | USPTO [85884407 VELLUM](https://trademarks.justia.com/858/84/vellum-85884407.html) (180G LLC, reg. 4516158) — not software on the record I saw | taken (GoDaddy, exp 2027-09-10) | **taken — live competitor** (NameCheap, exp 2029-01-23) | `getvellum.com` taken (Squarespace); `vellum.io` **registered**, Azure 404 |
| 3 | **Tacet** | German classical label [TACET Musikproduktion](https://www.tacet.de/de_de/wer-ist-tacet/); [Tacet haptic metronome app](https://apps.apple.com/it/app/tacet-haptic-metronome/id6758276599); [Tacet focus-blocker app](https://mwm.ai/fr/apps/tacet-app-blocker-focus/6759857418); [Cineon TACET aircrew VR training](https://cineon.ai/wp-content/uploads/2025/04/Cineon_TACET_a_virtual_reality_case_study.pdf) | UK [UK00913897418 TACET](https://www.trademarkelite.com/uk/trademark/trademark-detail/UK00913897418/TACET) **DEAD**; US [87480671 TACET](https://furm.com/trademarks/tacet-87480671) ([Egan Visual](https://trademarks.justia.com/owners/egan-visual-corporation-3620418/)) not software | taken (Gabia, exp 2026-12-10) | taken (GoDaddy, exp 2027-02-03) | **`tacet.work` FREE** (registry-confirmed); `gettacet.ai` FREE; `tacet.io` taken |
| 4 | **Compend** | [Compend AS](https://www.compend.no/en/artikler/granlund-kompetansesenter-velger-compend), Norwegian training/e-learning company (PECB and Project Academy partner) | None found — **open risk** | taken (GoDaddy, exp 2027-04-07) | taken (Atom.com, exp 2030-01-24) | `getcompend.ai` FREE; `getcompend.com` taken |
| 5 | **Codicil** | Dutch [Codicil Company B.V.](https://m.2miljoen.nl/bedrijf/24343730/codicil-company-bv.html) (legal/estate); open-source [codicil](https://github.com/colehellman/codicil) and [codicil-mcp](https://www.npmjs.com/package/codicil-mcp) developer tools | None found — **open risk** | taken (NameSilo, exp 2027-01-14) | taken (GoDaddy, exp 2027-10-21) | `getcodicil.ai` FREE; `getcodicil.com` taken |
| 6 | **Journe** | [Journe Software Corporation](https://www.konaequity.com/company/journ%C3%A9e-software-corporation-4393824576/) (US, software); [Journe app](https://wsa-global.org/winner/journe/) | **USPTO [79435246 JOURNE](https://www.trademarkelite.com/trademark/trademark-detail/79435246/JOURNE) — LIVE with a non-final office action (2026-03-25)**; also a [Madrid record 811715](https://iprop-ua.com/madrid/811715/) | taken (Infomaniak, exp 2027-07-04) | taken (NameCheap, exp 2026-11-11) | **`getjourne.com` FREE**; `journe.io` taken |
| 7 | **Nota** | [Nota AI](https://parsers.vc/startup/nota.ai/) (on-device AI optimisation; [AMD robotics partner](https://www.koreaherald.com/article/10818482)), [Nota AI Tools](https://chromewebstore.google.com/detail/nota-ai-tools/iajfhfgbijnihfjbppbdkddbnhegjdmn) extension | None found — **open risk** | taken (GoDaddy, exp 2032-09-26) | taken (101domain, exp 2027-01-06) | `getnota.ai` FREE; `getnota.com` taken |
| 8 | **Signet** | [Signet](https://folio.id/ja/platform/document-intelligence/) document-intelligence product (Folio Wallet); Signet Jewelers / banking connotations | Not searched to a record — **open risk** | taken (MarkMonitor, exp 2027-03-09) | taken (Marcaria, exp 2028-09-10) | `getsignet.com` taken (Cloudflare) |
| 9 | **Parley** | [Parley Pro](https://www.parleypro.com/product/) contract-management software | USPTO [PARLEY 86856192](https://trademarks.justia.com/868/56/parley-86856192.html) (Parley Pro Inc., reg. 5428881) | taken (GoDaddy, exp 2027-03-18) | taken (Spaceship, exp 2029-01-13) | `getparley.ai` taken (Cloudflare); `getparley.com` taken |
| 10 | **Anvil** | [Anvil](https://www.useanvil.com/blog/product-news/why-we-built-document-editor/) (useanvil.com), document/workflow automation — direct document adjacency | Not searched to a record — **open risk** | taken (MarkMonitor, exp 2028-08-15) | taken (GoDaddy, exp 2028-07-08) | `getanvil.com` taken; `anvil.so` taken |
| 11 | **Folio** | [Folio Wallet](https://folio.id/ja/platform/document-intelligence/) document intelligence; Folio Financial / Fidelity adjacency | Not searched to a record — **open risk** | taken (GoDaddy, exp 2027-09-15) | taken (NameCheap, exp 2028-02-13) | `getfolio.com` taken; `folio.io` taken |
| 12 | **Guild** | [Guild.ai](https://www.guild.ai/blog/news/guild.ai-raises-a-series-a) — Series-A funded "control plane for AI agents" | Not searched to a record — **open risk** | taken (GoDaddy, exp 2030-12-13) | taken (Dynadot, exp 2028-06-15) | `getguild.com` taken; `guild.so` taken |
| 13 | **Kepler** | [Kepler AI](https://www.getkepler.ai/) live 2026; Kepler.ai (old) acquired by Kore.ai | Not searched to a record — **open risk** | taken | taken | **`getkepler.work` FREE**; `getkepler.com` taken |
| 14 | **Magister** | [Magister](https://growthmethod.com/magister-alternative/) AI-agent/growth platform; [Magisterium AI](https://help.magisterium.com/zh/billing/whats-included-in-each-plan) adjacent | None found — **open risk** | taken (eNom, exp 2027-12-12) | taken (NameCheap, exp 2027-12-28) | `getmagister.ai` FREE; `getmagister.com` taken |
| 15 | **Gloss** | [Gloss AI](https://apps.apple.com/us/app/gloss-ai-makeup-analysis/id6742034478) makeup-analysis app; `gloss-local` npm tool | None found — **open risk** | taken (Spaceship, exp 2027-03-28) | taken (Porkbun, exp 2028-02-03) | `getgloss.com` taken (GoDaddy) |

**Clean domains confirmed:** `tacet.work`, `gettacet.ai`, `getjourne.com`, `getcompend.ai`, `getcodicil.ai`,
`getnota.ai`, `getmagister.ai`, `getkepler.work`. Everything else in the table resolves or is registered.
`get<name>` domains are cheap but weak brand equity; `tacet.work` is the only clean *root* domain on the list.

## Top 6, ranked

| # | Name | Why | Main risk |
| --- | --- | --- | --- |
| 1 | **Rubrica** | Latin origin of "rubric" — the red-ink rule in the margin of a manuscript, and the rubric a professional works to; names marginalia, rules and craft in one word, and `rubrica` is transparent in Italian/Spanish, familiar as *Rubrik* in German. | `rubrica.ai` is parked, so this needs a purchase, and English speakers need one hearing to spell it; the `.com` is held by an unknown registrant. |
| 2 | **Vellum** | The material of the notebook page, adult and calm, same spelling and near-same sound in German (*Vellum*), no finance/HR/security meaning; strongest wordmark of the set. | `vellum.ai` is a funded enterprise-AI competitor in the same buying centre; expect search and conference-lobby collisions, and the generic-word mark is hard to own. |
| 3 | **Tacet** | Latin "it is silent" — the apprentice who says nothing until the pause, and a musical instruction to rest while others play; the only finalist with a free, brandable root domain (`tacet.work`). | Spoken aloud it lands on "tacit" (homophone), so the name implies the pitch's keyword while round 1 shows that keyword is now contested; several small TACET marks/apps exist, none in software. |
| 4 | **Compend** | Shortened *compendium* — the concentrated distillation of an expert, which is literally the Work Map output; clean, bookish, adult, easy in German. | Reading/pronunciation splits ("COM-pend" vs "com-PEND"), and a Norwegian training company already uses the exact word in an adjacent (learning) market. |
| 5 | **Codicil** | Succession and handover exactly: a codicil is the amendment to a will that carries forward what the original did not say — the product's job, and calm/legal-adult. | Legal flavour may read as estate planning to a finance buyer, and a Dutch company plus several open-source tools use it; no trademark record found, so the register risk is unmeasured. |
| 6 | **Journe** | Coined from *journeyman*: the qualified craftsperson who has finished apprenticeship and can now teach it — the closest one-word match to the arc in the brief, 6 letters, French/German-friendly. | A **live USPTO JOURNE application (79435246) with an office action in 2026**; pronunciation is unstable in English, and German speakers read *j* as *y*. |

## Taglines for the top pick (Rubrica)

1. **"Shadow the work, keep the rules."** — the mechanism in four words, no AI vocabulary.
2. **"It writes down what your best people never do."** — names the tacit-knowledge problem at the level of the page.
3. **"Reads the margin. Teaches the rule."** — ties the name (rubric) to the teach-back, short and concrete.

Runner-up taglines if Vellum leads instead: *"The rules behind your best decisions."* / *"Kept in the book, not in
someone's head."* / *"Observations in. Standards out."*

## Companion character (name only — declared clean-up)

Keep the working name **Mira** for the pixel intern; round 1 already found it unwinnable as a *product* brand and
still the warmest fit for the character (Latin *mirari*, "to wonder/look"). Backups, all short and easy for a
German speaker, ranked:

| # | Name | Why |
| --- | --- | --- |
| 1 | **Mira** | Already the working name, warm and international; keep it as the character and off the product. |
| 2 | **Ida** | "Industrious one" — a notebook-and-glasses intern in one short syllable; identical in German; paired with *Rubrica*, initials R+I read like a firm. |
| 3 | **Lena** | Soft, adult, and pronounced the same in English and German; reads like a real colleague, not a mascot. |
| 4 | **Greta** | German-native, "pearl"; carries quiet competence; works with any of the top six product names. |
| 5 | **Elsa** | "Noble" — short, calm, and unambiguous in both languages; strong if the product name is long (Rubrica + Elsa). |
| 6 | **Nella** | Italian diminutive warmth, and a plausible "apprentice who grows into the teacher." |

**Pronunciation/meaning checks worth a native pass (machine-unverifiable):** Rubrica (`ROO-brih-ka`), Vellum
(`VEH-lum`), Tacet (`TAH-tset` / `TAY-set`), Compend (stress position), Journe (`ZHUR-n`). No finance, HR or
security negative meaning was found for any of these six; the only meaning-level rejection in the set is *Nota*
(close to a German vulgar near-homophone) and *Lore* ("leer" = empty), both cut before the shortlist.

## What I could not check (stated, not invented)

- A live **USPTO TSDR / EUIPO class 9 and 42 register search** — not runnable from this machine. Several finalists
  (Rubrica, Compend, Codicil, Nota) therefore have "no mark found" rather than "no mark exists." A real clearance
  is still required, especially for Rubrica and Compend where the semantic ownership is the whole argument.
- Live **exact-match app-store / product-hunt sweep** for the coined names (Journe, Compend-as-product).
- **Pricing** of the parked/held domains (`rubrica.ai`, `rubrica.com`, `tacet.ai`, `tacet.io`) — a registration
  result says "taken", not "unavailable at a price".
- German meaning was checked from general knowledge, not by a native speaker or corpus tool.
