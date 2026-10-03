# ERP task report

Changed `src/lib/erp/store.tsx` to poll the Shadow cases endpoint every four seconds while the provider is in API mode. A changed case ID set replaces the cases and rebuilds approvals; an unchanged set updates only statuses, preserving local booking edits and approval history. The existing API source state still drives the “Live data” badge. `applyAction` now waits for the Shadow `beforeSave` hook before changing state.

Changed the VAT display in `src/routes/invoice.$id.tsx` to convert fractional rates such as `0.19` to `19%`, while retaining percent-valued seed rates such as `19`.

Checked with `bun run build`; the client, SSR, and Nitro builds passed. Reviewed the polling branches and VAT conversion statically. I did not add a test file because the assigned implementation ownership is limited to the two named source files. I did not create a backend session or perform the live inbox check, as instructed, so that acceptance check remains for Opus to run during the demo.
