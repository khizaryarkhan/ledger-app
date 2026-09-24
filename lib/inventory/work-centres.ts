/** A non-negative hourly rate as the numeric(18,6) string it is stored as, or null if invalid. */
export const rate = (v: any): string | null => {
  const n = Number(v);
  return v === "" || v == null || !Number.isFinite(n) || n < 0 ? null : (Math.round(n * 1e6) / 1e6).toString();
};
