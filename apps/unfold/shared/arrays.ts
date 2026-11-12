/** Checks array emptiness; callers must handle missing values explicitly. */
export function isEmpty<T extends readonly unknown[]>(items: T): items is T & readonly [] {
  return items.length === 0
}

/** Preserves mutability and narrows the first element to an existing slot. */
export function isNotEmpty<T extends readonly unknown[]>(items: T): items is T & readonly [T[number], ...T[number][]] {
  return items.length > 0
}
