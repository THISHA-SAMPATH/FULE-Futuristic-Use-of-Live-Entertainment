const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function validateJsonValue(value, { maxDepth = 16, maxCollectionSize = 200, maxStringLength = 8192 } = {}) {
  const stack = [{ value, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > maxDepth) return { valid: false, error: `JSON nesting cannot exceed ${maxDepth} levels.` };
    if (typeof current.value === 'string' && current.value.length > maxStringLength) return { valid: false, error: `Text fields cannot exceed ${maxStringLength} characters.` };
    if (typeof current.value === 'number' && !Number.isFinite(current.value)) return { valid: false, error: 'Numbers must be finite.' };
    if (Array.isArray(current.value)) {
      if (current.value.length > maxCollectionSize) return { valid: false, error: `Arrays cannot contain more than ${maxCollectionSize} items.` };
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (current.value && typeof current.value === 'object') {
      const entries = Object.entries(current.value);
      if (entries.length > maxCollectionSize) return { valid: false, error: `Objects cannot contain more than ${maxCollectionSize} fields.` };
      for (const [key, item] of entries) {
        if (forbiddenKeys.has(key)) return { valid: false, error: 'Payload contains a forbidden property.' };
        if (key.length > 128) return { valid: false, error: 'Property names cannot exceed 128 characters.' };
        stack.push({ value: item, depth: current.depth + 1 });
      }
    }
  }
  return { valid: true };
}
