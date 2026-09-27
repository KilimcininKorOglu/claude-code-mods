/** Orders two strings that sort as they compare (ISO times, ULIDs) from the greater to the smaller. */
export function descending(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? 1 : -1
}

/** Orders two strings that sort as they compare (ISO times, ULIDs) from the smaller to the greater. */
export function ascending(left: string, right: string): number {
  return descending(right, left)
}
