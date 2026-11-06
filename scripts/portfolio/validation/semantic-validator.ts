import { isNonEmptyString, isRecord, result } from "./shared.ts";
import type { PortfolioSnapshot, ValidationResult } from "./types.ts";
export function validatePortfolioSemantics(output: unknown, snapshot: PortfolioSnapshot): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(output)) return { ok: false, errors: ["semantic: expected a Gemini output object"] };
  if (output.gallery === null) return result(errors);
  if (!isRecord(output.gallery)) return { ok: false, errors: ["semantic: gallery must be an object or null"] };
  const gallery = output.gallery;
  if (!Array.isArray(snapshot.posts)) return { ok: false, errors: ["snapshot.posts: expected an array"] };
  const posts = new Map<string,string>();
  for (const post of snapshot.posts) {
    if (!isRecord(post) || !isNonEmptyString(post.source_id) || typeof post.body !== "string") { errors.push("snapshot.posts: each post requires source_id and body"); continue; }
    if (posts.has(post.source_id)) errors.push(`snapshot.posts: duplicate source_id ${post.source_id}`);
    posts.set(post.source_id,post.body);
  }
  if (!Array.isArray(gallery.source_ids) || !Array.isArray(gallery.roles)) return { ok: false, errors: [...errors,"gallery: source_ids and roles must be arrays"] };
  const sourceIds = gallery.source_ids;
  const roleIds: string[] = [];
  for (const id of sourceIds) {
    if (!isNonEmptyString(id)) { errors.push("gallery.source_ids: invalid identifier"); continue; }
    if (!posts.has(id)) errors.push(`SOURCE_NOT_IN_SNAPSHOT: ${id}`);
  }
  gallery.roles.forEach((role,index) => {
    if (!isRecord(role)) { errors.push(`gallery.roles[${index}]: expected an object`); return; }
    const id = role.source_id;
    if (!isNonEmptyString(id)) { errors.push(`gallery.roles[${index}].source_id: invalid identifier`); return; }
    roleIds.push(id);
    const body = posts.get(id);
    if (body === undefined) errors.push(`ROLE_SOURCE_NOT_IN_SNAPSHOT: ${id}`);
    if (!Array.isArray(role.evidence)) { errors.push(`gallery.roles[${index}].evidence: expected an array`); return; }
    role.evidence.forEach((evidence,evidenceIndex) => {
      if (!isRecord(evidence) || !isNonEmptyString(evidence.quote)) errors.push(`gallery.roles[${index}].evidence[${evidenceIndex}]: missing quote`);
      else if (body !== undefined && !body.includes(evidence.quote)) errors.push(`QUOTE_NOT_EXACT: source_id=${id}, evidence_index=${evidenceIndex}`);
    });
  });
  if (new Set(sourceIds).size !== sourceIds.length) errors.push("gallery.source_ids: duplicate identifiers");
  if (new Set(roleIds).size !== roleIds.length) errors.push("gallery.roles: duplicate source identifiers");
  const declared = new Set(sourceIds);
  const assigned = new Set(roleIds);
  if (declared.size !== assigned.size || [...declared].some((id) => !assigned.has(id)) || [...assigned].some((id) => !declared.has(id))) errors.push("ROLE_SOURCE_SET_MISMATCH: roles must map one-to-one to source_ids");
  return result(errors);
}
