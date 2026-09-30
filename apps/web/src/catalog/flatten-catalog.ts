/** 把「資源＋其時段」攤平成單一時段列表，每筆帶上資源名稱與單筆名額上限。 */
export function flattenCatalog<S>(
  catalog: readonly { resource: { name: string; seatsPerHold: number }; slots: readonly S[] }[],
): (S & { resourceName: string; seatsPerHold: number })[] {
  return catalog.flatMap(({ resource, slots }) =>
    slots.map((slot) => ({ ...slot, resourceName: resource.name, seatsPerHold: resource.seatsPerHold })),
  );
}
