/** Portable *, ** and ? matching, bounded by pattern length × path length. */
export function globMatcher(pattern: string): (path: string) => boolean {
  if (
    !pattern.startsWith("/") ||
    pattern.length > 512 ||
    pattern.includes("\\") ||
    pattern.split("/").some((segment) => segment === "." || segment === "..")
  )
    throw new Error("Use an absolute glob without dot segments or backslashes.");
  const tokens: { kind: "literal" | "star" | "tree" | "directories" | "one"; value?: string }[] =
    [];
  const chars = Array.from(pattern);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    if (char === "*" && chars[i + 1] === "*") {
      i++;
      if (chars[i + 1] === "/") {
        i++;
        tokens.push({ kind: "directories" });
      } else tokens.push({ kind: "tree" });
    } else if (char === "*") tokens.push({ kind: "star" });
    else if (char === "?") tokens.push({ kind: "one" });
    else tokens.push({ kind: "literal", value: char });
  }
  return (path) => {
    const chars = Array.from(path);
    let previous = Array<boolean>(chars.length + 1).fill(false);
    previous[0] = true;
    for (const token of tokens) {
      const next = Array<boolean>(chars.length + 1).fill(false);
      const repeated =
        token.kind === "star" || token.kind === "tree" || token.kind === "directories";
      next[0] = repeated && previous[0]!;
      let earlier = false;
      for (let i = 1; i <= chars.length; i++) {
        const char = chars[i - 1]!;
        earlier ||= previous[i - 1]!;
        if (token.kind === "directories") next[i] = previous[i]! || (char === "/" && earlier);
        else if (repeated)
          next[i] = previous[i]! || (next[i - 1]! && (token.kind === "tree" || char !== "/"));
        else
          next[i] =
            previous[i - 1]! && (token.kind === "one" ? char !== "/" : char === token.value);
      }
      previous = next;
    }
    return previous[chars.length]!;
  };
}
