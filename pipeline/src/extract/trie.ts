class Node<V> {
  children = new Map<string, Node<V>>();
  value: V | undefined;
}

export class Trie<V> {
  private root = new Node<V>();
  size = 0;

  insert(key: string, value: V): void {
    if (key.length === 0) return;
    let n = this.root;
    for (const ch of key) {
      let next = n.children.get(ch);
      if (!next) {
        next = new Node<V>();
        n.children.set(ch, next);
      }
      n = next;
    }
    if (n.value === undefined) this.size++;
    n.value = value;
  }

  longestMatch(text: string, i: number): { end: number; value: V } | null {
    let n = this.root;
    let last: { end: number; value: V } | null = null;
    for (let j = i; j < text.length; j++) {
      const next = n.children.get(text[j]!);
      if (!next) break;
      n = next;
      if (n.value !== undefined) last = { end: j + 1, value: n.value };
    }
    return last;
  }
}
