export function maskQuotes(text: string): string {
  const out = text.split('');
  const stack: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    if (ch === '「' || ch === '『') {
      stack.push(ch);
      continue;
    }
    if (ch === '」' && stack[stack.length - 1] === '「') {
      stack.pop();
      continue;
    }
    if (ch === '』' && stack[stack.length - 1] === '『') {
      stack.pop();
      continue;
    }
    if (stack.length > 0) out[i] = '\u0000';
  }
  return out.join('');
}

export function parenDepths(text: string): Int16Array {
  const d = new Int16Array(text.length);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '（' || ch === '(') {
      depth++;
      d[i] = depth;
    } else if (ch === '）' || ch === ')') {
      d[i] = depth;
      depth = Math.max(0, depth - 1);
    } else {
      d[i] = depth;
    }
  }
  return d;
}

export function matchingClose(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '（' || ch === '(') depth++;
    else if (ch === '）' || ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
