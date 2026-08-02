const normalizeTrackingNumber = (value) =>
  String(value ?? "").trim().slice(0, 120);

const deduplicate = (values) =>
  [...new Set(values.map(normalizeTrackingNumber).filter(Boolean))];

export const getPreferredTrackingNumbers = ({
  parcels,
  aggregateTrackingNumber
} = {}) => {
  const parcelNumbers = deduplicate(
    (Array.isArray(parcels) ? [...parcels] : [])
      .sort(
        (left, right) =>
          Number(left?.parcel_index || 0) - Number(right?.parcel_index || 0)
      )
      .map((parcel) => parcel?.tracking_number)
  );

  if (parcelNumbers.length > 0) return parcelNumbers;

  return deduplicate(
    String(aggregateTrackingNumber ?? "").split(",")
  );
};
