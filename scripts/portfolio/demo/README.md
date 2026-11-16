# Portfolio demo seed

This is an isolated demonstration fixture, not production Portfolio state.

- `src/portfolio-demo-seed.json` is the single source of gallery presentation data for the `/portfolio-demo` route.
- `lifecycle-registry.json` contains six synthetic active galleries (36 source IDs) and two retired demo galleries (12 source IDs) with individual 60-day cooldown timestamps.
- Every referenced source ID is an existing archive Markdown basename and has a matching image in `public/images/archive/`.
- Gallery names, statements, captions, facets and lifecycle timestamps are illustrative, not verified curation or usage history.
- The production `scripts/portfolio/lifecycle-registry.json` is separate and is not populated from this fixture.

The demo route is deliberately separate from `/portfolio`; this fixture must never be treated as a production lifecycle registry without an explicit migration step.
