export const isMissingShipmentAutomationColumn = (error) =>
  String(error?.code || "") === "42703" &&
  /shipments\.(?:label_purchase_error|label_purchase_started_at)|column (?:shipments\.)?(?:label_purchase_error|label_purchase_started_at)/i.test(
    String(error?.message || "")
  );

export async function readShipmentsWithLegacyFallback({
  readCurrent,
  readLegacy,
  onLegacyFallback
}) {
  const current = await readCurrent();
  if (!current?.error || !isMissingShipmentAutomationColumn(current.error)) {
    return current;
  }

  onLegacyFallback?.(current.error);
  return readLegacy();
}
