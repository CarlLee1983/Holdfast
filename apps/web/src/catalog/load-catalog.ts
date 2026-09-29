type AppRpc = Env["APP"];
type ResourceList = Extract<Awaited<ReturnType<AppRpc["listResources"]>>, { ok: true }>["data"];
type SlotList = Extract<Awaited<ReturnType<AppRpc["listSlots"]>>, { ok: true }>["data"];

export interface ResourceWithSlots {
  resource: ResourceList[number];
  slots: SlotList;
}

/**
 * 經 RPC 取得所有資源與其尚未結束的時段。
 * RPC 回報失敗時直接丟出錯誤，不當作「沒有資料」，避免把故障顯示成空列表。
 */
export async function loadCatalog(app: AppRpc): Promise<ResourceWithSlots[]> {
  const resources = await app.listResources();
  if (!resources.ok) {
    throw new Error(`listResources 失敗：${resources.reason}`);
  }

  return Promise.all(
    resources.data.map(async (resource) => {
      const slots = await app.listSlots(resource.id);
      if (!slots.ok) {
        throw new Error(`listSlots(${resource.id}) 失敗：${slots.reason}`);
      }
      return { resource, slots: slots.data };
    }),
  );
}
