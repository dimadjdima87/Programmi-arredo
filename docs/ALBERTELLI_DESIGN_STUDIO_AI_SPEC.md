# ALBERTELLI DESIGN STUDIO AI
## Product Requirements Document (PRD) + Technical Architecture + Codex Implementation Brief
Version: 1.0 — 21 October 2026
Language: Italian UI; internal identifiers and source code may be in English.
Status: implementation proposal, not a claim that the software already exists.

## 0. Executive decision
Build a browser-based, desktop-first interior design application for Albertelli Arredamenti. Start with a dependable, bounded MVP focused on kitchens and living rooms, moodboards and catalog management, editable 2D room geometry, simple 3D preview and customer exports. Add photorealistic 3D and AI-assisted refinements progressively, without using generative imagery as the source of truth for precise measurements or SKU fidelity.

### Product principles
1. **Technical truth wins**: room geometry, openings, coordinates, product dimensions and approved bill of materials are canonical structured data.
2. **Catalog truth**: never invent a manufacturer SKU, finish, price, compatibility, dimension or product image. Flag uncertain/incomplete data as `unverified` and require operator confirmation.
3. **Creative freedom with guardrails**: AI may suggest styles, fabrics, color combinations, lighting and accessories, but recommendations must distinguish real catalog entries from generic inspiration.
4. **Non-destructive edits**: never alter unspecified attributes when applying a natural-language command. Support preview, rollback and version history.
5. **Human approval**: no automatically approved layouts, commercial prices, orders or customer communications.
6. **Fast everyday workflow**: reduce manual steps, measure real latency rather than promise immediate or exact rendering times.
7. **Privacy**: minimize client PII, access control, configurable retention, licensed assets and consent for external AI processing.

## 1. Users and roles
- Admin: company settings, employees, integration keys, catalog approval, data exports, audit.
- Interior Designer / Sales Designer: clients, projects, layouts, moodboards, renders, proposals.
- Catalog Manager: import assets, SKUs, dimensions, manufacturer and finish revisions.
- Viewer: read-only access to assigned projects and presentations.
- Future customer portal: share explicitly approved project snapshots only.

## 2. Use cases
UC-01: Create project and optionally associate a customer record; collect room type, dimensions, budget range, priorities, styles, inspiration photographs and constraints.
UC-02: Upload floor plan as PNG/JPG/PDF, calibrate manually using two endpoints and a known length; mark scale as unverified until confirmed. Manual room drawing remains available without upload.
UC-03: Draw editable polygonal room boundary with numeric dimensions; position doors/windows with offsets, size and swing; snap to grid/walls; switch to top-down and 3D view.
UC-04: Choose manufacturer / product / model / component / finish from approved catalog; place, rotate, duplicate and align objects; warn about geometric collisions.
UC-05: Define project constraints: fixed walls, openings, fixed furniture, chosen SKU/finishes; lock objects or properties.
UC-06: Collect preferences and generate 2–3 moodboard directions; each contains palette, catalog-grounded selection, generic inspiration clearly labeled, material references, a concise rationale and suggestions.
UC-07: User edits moodboard manually; replaces swatches and adds notes; freezes an approved concept.
UC-08: Natural-language intent: “Change only base fronts to finish X; leave geometry and every other object untouched.” Generate proposed structured patch, validate permitted changes, preview and commit only after confirmation.
UC-09: Generate 3D preview from scene graph; inspect by orbit and walkthrough camera. Initial placeholder or primitive 3D proxies are visibly differentiated from SKU-accurate meshes.
UC-10: Render canonical scene with 3D renderer when models/materials are ready; optional AI concept illustration as separate explicitly labeled mode, not measurement-faithful output.
UC-11: Save versions, compare two variants, undo/redo, restore an older snapshot.
UC-12: Generate branded PDF summary with moodboard, SKU list, chosen finishes, layout image, selected render images, notes and disclaimers.

## 3. Screen information architecture
A. Login / workspace: recent projects, search, filters, new project.
B. Project brief: customer (optional), environment, style, colors, budget, requirements, attachments, references.
C. Plan editor: plan image underlay, calibrated scale, room polygon, dimension overlays, walls, doors, windows, furniture footprints, right-side properties inspector, layers and locks.
D. Product catalog: brands, family, SKU, finish and dimension filters, image, technical data, availability status: verified / draft / unavailable.
E. Moodboard Studio: side-by-side 3 proposals; editable material cards, color swatches, products and rationales; tagged as 'Catalog item' or 'Conceptual suggestion'.
F. 3D Studio: synchronized scene, camera presets, light settings and material inspector, low-res preview; quality modes.
G. AI Assistant sidebar: user request, proposed diffs, warnings, approve / reject, history.
H. Output: variants, render gallery, PDF preview, export and share permissions.
I. Settings: roles, providers, cost caps, brands, asset licenses, retention, logs.

## 4. Data model (first migration)
- users(id, email, name, role, password_hash/identity_provider_id, created_at)
- customers(id, name, contacts_encrypted_or_access_restricted, consent_metadata, created_at)
- projects(id, customer_id_nullable, title, room_type, design_brief_json, status, owner_id, created_at, updated_at)
- project_assets(id, project_id, kind, storage_key, mime, file_hash, licensing, uploaded_by)
- manufacturers(id, name, brand_assets_metadata)
- catalog_products(id, manufacturer_id, manufacturer_sku, family, model, product_type, dimensions_mm_json, geometry_asset_id_nullable, verified_status, valid_from, catalog_version, metadata_json)
- catalog_finishes(id, manufacturer_id, code, name, type, color_hex_nullable, texture_asset_id_nullable, verified_status, finish_version)
- catalog_product_finishes(product_id, finish_id, compatibility_status, source_reference)
- materials(id, name, family, swatch_asset_id, physically_based_properties_json, verified_status)
- scenes(id, project_id, name, scene_json, plan_calibration_json, revision_number, created_at)
- scene_versions(id, scene_id, sequence, snapshot_json, diff_json, author_id, created_at)
- moodboards(id, project_id, title, style_direction, palette_json, cards_json, notes, ai_provenance_json, status)
- generation_jobs(id, project_id, job_type, provider, model_version, input_hash, output_asset_id_nullable, status, error_safe, estimated_cost_nullable, actual_cost_nullable, started_at, completed_at)
- presentations(id, project_id, version_snapshot_ids_json, export_asset_id, visibility, created_at)
- audit_events(id, actor_id, entity_type, entity_id, operation, detail_json_redacted, timestamp)

Use UUIDs, foreign keys, migration scripts and indexes by project, owner, SKU, manufacturer, and job status. Keep schema changes backward compatible whenever possible. Store files in object storage; never save binary blobs in database.

## 5. Canonical scene schema
All dimensions in millimeters. All positions are scene-local coordinates in millimeters. Define axis orientation explicitly. Scene stores: room perimeter as ordered vertices; wall heights/thickness; openings with wall association, offsets, width/height and sill; elements with stable IDs, product IDs, transform (position, rotation), exact bounding dimensions, surface/finish mappings, lock flags and verified-status metadata; cameras and lighting; provenance and latest revision.

Example:
```json
{
  "schemaVersion": "1.0",
  "units": "mm",
  "coordinateSystem": "right-handed; X horizontal, Y vertical, Z up",
  "room": { "polygon": [[0,0],[4200,0],[4200,3600],[0,3600]], "height": 2700 },
  "openings": [{ "id": "door-1", "wallIndex": 0, "offsetMm": 300, "widthMm": 800, "heightMm": 2100, "kind": "door" }],
  "elements": [{
    "id": "base-1", "catalogProductId": null,
    "label": "Provisional cabinet footprint",
    "positionMm": [500,400,0], "rotationDeg": [0,0,0],
    "dimensionsMm": [600,600,870], "finishAssignments": {},
    "locked": { "geometry": true, "position": true, "finishes": false },
    "verification": "placeholder"
  }],
  "cameras": [], "lighting": [], "revision": 1
}
```
The above is sample DEMO geometry, never claim it is an actual brand configuration. Maintain a well-documented schema with runtime validation (Zod/Pydantic) and migrations.

## 6. AI stylist responsibilities
Input: brief, light exposure if known, intended uses, space constraints, permitted brands, verified products, desired style, palette preferences, price tier (if known), previous design decisions.
Output using JSON Schema: `directions[]`: id, title, summary, palette[] (hex, label), materials[] (verified catalog references or explicit inspiration tag), recommended_products[] (verified product IDs only), optional_generic_suggestions[], design_rationale[], lighting_advice[], implementation_warnings[], open_questions[].
Rules:
- AI cannot assert a product is available without approved catalog verification.
- Price / lead time / stock always 'unknown' unless independently sourced and current.
- Don't impersonate a licensed architect or give normative technical sign-off. Keep safety/codes for human review.
- Save source IDs, model name, prompt template version and response for reproducibility.
- Approval/editing by designer is required before locking a moodboard.
- Concept image generation, if enabled, is marked “Concept illustration — not technical representation”.
- Apply quality rubric: harmony, contrast, material balance, room luminosity, maintenance and ergonomics; score must be explained, never treated as an objective professional certification.

## 7. Patch-based AI editing — critical invariant
Text instruction -> intent classifier -> structured patch proposal -> permission validator -> rule checker -> visible diff -> explicit user approval -> atomic update -> version snapshot.
Allowed patch operations: update_finish, update_material, replace_catalog_product, adjust_lighting, update_camera, move_object, rotate_object, add_object, remove_object. Each op must name exact target IDs. If a requested operation violates a lock, reject it with reason. If “change finishes only”, geometry and item count must have identical hashes before and after. No silent fallback to another SKU. Do not overwrite prior renders; mark them linked to previous scene version.

## 8. Rendering architecture
**Mode 1 — Interactive preview**: Three.js via React Three Fiber for in-browser 3D and orbit controls. Start with geometrically accurate primitive proxies, textures and lighting; upgrade with licensed manufacturer GLB/glTF assets.
**Mode 2 — Technical photorealistic renderer**: separate Blender worker using Python API and physically based materials, compositing, cameras and configurable output quality. Keep scene conversion isolated behind `RendererAdapter`. Validate dimensions and objects after conversion. Queue jobs and permit cancellations. Performance depends on models, hardware and resolution.
**Mode 3 — AI concept visualization**: optional image generation/editing for style exploration. Cannot be labeled dimensionally accurate or product-faithful; treat changes to exact geometry as unsafe/unverified unless reconstructed/checked against canonical scene.
Don't use generative image editing as the canonical renderer for real SKU representations.

## 9. Stack recommendation
- Web frontend: TypeScript, React, Next.js (current supported stable release verified at implementation), Tailwind CSS; reusable design system.
- 2D plan editor: react-konva/Konva; geometry calculations independent of pixel scale; pan, zoom, snapping and dimension overlays.
- 3D interactive: Three.js + React Three Fiber + Drei; glTF loader and raycast object picking.
- Backend: Python FastAPI with Pydantic models, or a well-justified TypeScript API alternative; choose one clear service boundary.
- DB: PostgreSQL + SQL migrations; locally Docker Compose. Consider PostGIS only if truly needed, not by default.
- Object files: S3-compatible storage (local dev MinIO).
- Background jobs: Celery + Redis or comparable explicit job queue with retries/idempotency.
- Photorealistic render: Blender worker in isolated container with pinned compatible version and headless test scene.
- AI: provider adapter; server-side credentials; current OpenAI structured output for recommendations and supported image API for optional concept art. Design for provider switching.
- Security: RBAC, protected access to project/customer files, encryption/TLS, logs with PII redaction, GDPR-oriented deletion/export and retention policy.
- Quality: Playwright E2E + Vitest frontend + pytest backend + typecheck/lint.
- Observability: job logs, duration, failures, token counts/estimated costs where available; administrative cost caps.

## 10. Phased delivery
### Phase 0: Architecture / repo (first Codex task)
Monorepo scaffold, README, architecture decisions, Docker Compose, database schema, seed data, CI, tests, environment template and dummy providers. No API secrets committed.
### Phase 1: Usable vertical slice
Login in development, create project, brief, draw rectangle/polygon room with numeric measurements, single door/window, furniture footprints with demonstrative catalog data, save/load, undo/redo, export screenshot, basic moodboard via rules/mock data. Scene version snapshots. The initial slice must work end-to-end offline with dummy AI.
### Phase 2: Moodboard and approved catalog
Brand/product/finish CRUD, CSV import with error report, provenance/license fields, product filtering, uploaded swatches, real AI structured suggestions referencing only catalog IDs, moodboard editor and approval.
### Phase 3: 3D editor
Scene sync, orbit controls, camera selection, material assignment, placeholder / accurate asset badges, import validated GLB, collision warnings and scene regression tests.
### Phase 4: Render and presentation
Blender render worker, queued jobs, image gallery, scene-revision watermark/metadata, PDF branded export and cost dashboard. Optional concept imagery clearly separated from technical rendering.
### Phase 5: Advanced AI, plan assistance, CRM
AI patch commands, side-by-side variants, plan image line tracing assistance with human calibration, richer product rules, project handoff and future integrations.

## 11. MVP acceptance criteria
- Designer creates a sample project and saves it, reloads without dimension drift.
- Room dimensions displayed and stored in mm; conversion from canvas pixels does not corrupt measurements.
- Door/window attaches to chosen wall; wall endpoints and opening sizes persist.
- All sample products are explicitly `DEMO` and no fictional manufacturer SKU is attributed to a real brand.
- Placed item exact ID survives save/load and versions; undo/redo works for add/move/update.
- Selecting a verified finish updates appropriate swatch/material reference, not coordinates.
- Moodboard shows at least 2 directions with catalog references or explicit conceptual suggestions.
- Designer can edit, approve, export a moodboard image/PDF. Export reflects the selected version.
- Unauthorized users cannot retrieve another user's private project via API or object storage.
- Unit tests prove a finish-only command cannot alter geometry or furniture count.
- Every AI/API failure is recoverable and has clear user-facing status; AI integrations may be disabled without breaking design workflow.
- README runs from clean checkout via documented commands with example env, migrations, demo data and smoke test.

## 12. Risks, legal and external dependencies
1. Manufacturer imagery, SKU catalogs, models, materials and logos require licenses/permission for intended use and redistribution. No unlicensed scraping.
2. PDF floor plans and photos are not inherently dimensionally reliable. Calibration / technical check is required.
3. AI generated images can hallucinate door positions, handles, accessories or finishes; never claim technical fidelity without geometry-based render validation.
4. User/customer uploads may include names, addresses or private photos; use access controls and prevent indiscriminate AI provider sharing.
5. Photorealistic rendering can require GPU compute and modeling assets; actual expense and speed must be benchmarked.
6. Prices and stock must only come from verified source with timestamp or be omitted.
7. Aesthetic suggestions aren't substitutes for architectural compliance, electrical/plumbing plans or technical installation clearance.

## 13. First demo (no licensed data required)
Use a fictional, generic project named 'Demo cucina contemporanea': rectangular 4200 x 3600 mm room, one door and one window placed manually, anonymous cabinet placeholders, two invented style directions explicitly labeled DEMO, warm and cool color palettes, two scene snapshots, editable materials and exported moodboard. Use procedurally generated preview swatches. Avoid real manufacturer codes until authorized files are imported.

## 14. Indicative resource needs (not commercial quotes)
- Small internal prototype: local laptop/desktop, developer environment, local PostgreSQL and object storage.
- Team production: hosted backend, secured storage, GPU rendering machine or metered rendering service, AI API budget, backups and monitoring.
- Major workload/cost driver: creating or licensing manufacturer-accurate 3D assets and finish textures, more than basic CRUD pages.
- Estimate actual costs only after proof-of-concept tests on 3 real workflows and agreed monthly volume.

## 15. Instructions for Codex
You are the lead full-stack engineer and technical architect for Albertelli Design Studio AI. Treat this PRD as source-of-truth requirements. Start with Phase 0 and Phase 1 only, not all features at once. Before coding, produce concise architecture decisions and an executable task breakdown. Then implement an end-to-end working prototype with the prescribed tests. Prioritize scene-data correctness and extensibility over showy mockups. Use DEMO data without inventing branded catalogue entries. Treat uploaded assets as user-provided and do not scrape copyrighted catalogs. Never embed API keys in client bundle. For every increment: show changed files, runnable commands, test results, known limitations and a short demo walkthrough. Do not claim code tested unless it was actually executed. Ask only blocking questions; otherwise make explicit reversible engineering decisions. Provide a schema and endpoint contract and an easy-to-run local configuration. Remain in Italian for UI labels, user guidance and status messages. Offer the next milestone only after current tests pass.

### First Codex deliverables
1. `README.md` containing prerequisites, start/test steps.
2. `docs/architecture.md` with source of truth diagrams, design decisions and trust boundaries.
3. `docs/milestones.md` with checkboxes and acceptance criteria.
4. Working frontend and backend with Docker Compose and seeded DEMO catalog.
5. Editor to create room, place demo items, attach opening, save/reload.
6. Rule-based moodboard demo with 2 directions and editable palette.
7. Scene revision history, undo/redo tests and API access control tests.
8. Screenshots/video are optional, never required to claim tests.

## 16. Later clarifications (non-blocking for the MVP)
- Supported workstation OS, average number of simultaneous designers.
- Existing catalogue assets / agreements with each furniture brand.
- Which paid providers, hosts or render hardware the business prefers.
- Exact branding and logos with usage rights.
- Source format of drawings produced by the company today.
- Data retention period and legal privacy text.
- Priority ranking: kitchen vs living room vs bedrooms; default MVP kitchen first.

## 17. Primary official technology documentation
- OpenAI Image API: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Blender Python: https://docs.blender.org/api/main/index.html
- Konva React transformer: https://konvajs.org/docs/react/Transformer.html
