/** JSONB can reorder object keys. Preserve ordered arrays while comparing actual draft content. */
export function wizardConfigKey(value: unknown): string {
  return (
    JSON.stringify(value, (_key, entry: unknown) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.entries(entry).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : entry,
    ) ?? ""
  );
}
