/**
 * Strips Markdown the model sometimes writes despite being asked for plain text, since chat
 * bubbles show text as-is. Lists become "•" bullets so they still read as lists.
 */
export function plainText(text: string): string {
  return (
    text
      // Headings: "## Best option" → "Best option"
      .replace(/^#{1,6}\s+/gm, "")
      // Bullets: "- item" or "* item" → "• item"
      .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
      // Bold and italics, but not lone asterisks or snake_case words
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      .replace(/(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, "$1")
      .replace(/(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/g, "$1")
      // Inline code
      .replace(/`([^`\n]+)`/g, "$1")
      // Links: "[Trip Planner](https://…)" → "Trip Planner"
      .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
  );
}
