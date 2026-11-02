/**
 * Reserve a unique, app-issued identifier. It deliberately has no country/area
 * code and is not a phone number. The unique constraints make allocation safe
 * when two devices restore the same identity at once.
 */
export async function getOrCreateAppNumber(db: any, userId: string): Promise<string> {
  const existing = await db.from("app_number_directory").select("app_number").eq("user_id", userId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.app_number) return existing.data.app_number as string;

  for (let attempt = 0; attempt < 32; attempt++) {
    const random = new Uint32Array(2);
    crypto.getRandomValues(random);
    const number = `${10000 + (random[0] % 90000)}-${String(random[1] % 10000).padStart(4, "0")}`;
    const inserted = await db.from("app_number_directory").insert({ app_number: number, user_id: userId });
    if (!inserted.error) return number;

    // Another device may have won the allocation race for this user.
    const raced = await db.from("app_number_directory").select("app_number").eq("user_id", userId).maybeSingle();
    if (!raced.error && raced.data?.app_number) return raced.data.app_number as string;
    if (inserted.error.code !== "23505") throw inserted.error;
  }
  throw new Error("Não foi possível gerar um número exclusivo. Tente novamente.");
}