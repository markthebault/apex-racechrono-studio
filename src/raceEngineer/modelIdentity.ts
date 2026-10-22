// OpenRouter can return the dated deployment behind a selected model alias.
// Only the public catalog may establish that relationship; a shared prefix
// alone is never evidence that two models are the same.
const normalizeDate = (id: string) =>
  id.replace(/-(\d{4})-(\d{2})-(\d{2})$/, "-$1$2$3");

export function sameCatalogModel(
  selected: string,
  returned: string,
  catalog: unknown,
): boolean {
  if (selected === returned) return true;
  // Keep explicitly selected routing variants exact, including paid/free tags.
  if (selected.includes(":") || returned.includes(":")) return false;
  const rows = (catalog as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return false;
  const identity = (id: string) => {
    const row = rows.find(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.canonical_slug === "string" &&
        r.canonical_slug &&
        (normalizeDate(r.id) === normalizeDate(id) ||
          normalizeDate(r.canonical_slug) === normalizeDate(id)),
    );
    return row ? normalizeDate(row.canonical_slug) : undefined;
  };
  const expected = identity(selected);
  return !!expected && expected === identity(returned);
}
