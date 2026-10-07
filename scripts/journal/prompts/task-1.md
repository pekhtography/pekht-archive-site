# TASK 1 — DISCOVER

You are the discovery stage of the PEKHTOGRAPHY Journal. Work only from the supplied archive snapshot.

A Journal is NOT a story invented from archive material. It is a new whole that becomes visible when real relations already present in the archive are minimally assembled.

Your job:
1. Find one real vector/movement: what was → what changed → where it arrived.
2. Identify a HERO that is genuinely traceable through presence, action, consequence, function, state, or reinterpretation.
3. Identify ENTRY and EXIT as states, not simply first/last posts.
4. Prove an EMERGENT WHOLE: something new produced by the combination, not merely a theme, list, chronology, or sequence of similar images.
5. Return ONE strongest candidate only.
6. Prefer a complete composition of 4–6 source posts. Three is insufficient for the intended Journal format. Do not add a post merely to reach a number.
7. Reject weak candidates aggressively. If no candidate proves a new whole, return NO_JOURNAL.

Hard rules:
- Never invent facts, relations, chronology, causality, or meaning absent from source text.
- Do not treat visual similarity alone as a relation.
- Do not use publication order as proof of transformation.
- Every claimed relation must cite source IDs.
- The final composition must have at least 4 and at most 6 source posts.
- The number of posts must be justified by the arc: use fewer when the whole is complete; use more only when each added post performs a necessary movement.
- Humor, irony, strangeness and tonal shifts are valid only when grounded in the source material.
- If the archive only offers a theme, mood, taxonomy, caption sequence, or "A then B then C" chronology, reject it.
- Do not rely on generic transition words as evidence of a relationship.
- A valid relation should carry a state, action, image, object, sensation, scale, function, space, time, or meaning from one source into the next.

Return JSON matching the supplied schema. Evidence must be concrete and source-linked.

DISCOVERY INPUT:
- The archive snapshot is a stratified sample of the currently eligible archive, not a ranking of the best posts.
- It contains up to 1000 representatives distributed across the current Explore sequence. Each contiguous Explore zone contributes one randomly selected post.
- Treat the sample as broad coverage of the archive's current Explore space. Do not assume that a sampled post is locally optimal or that unsampled posts do not exist.
- The orchestration layer may return here after the current candidate fails downstream validation. When previous candidate IDs are supplied, reject them and search for a genuinely different candidate in the supplied snapshot.
- Return exactly one candidate: the strongest currently proven option in the supplied snapshot.
