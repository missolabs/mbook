// A small but complete book used across the book-domain tests: frontmatter with
// two fields, a book title, two chapters, merged prose, a travessão dialogue
// line, a decorative separator, and a `###` line (which is prose, not a heading).
export const BOOK_LINES: readonly string[] = [
  "---",
  "title: O Jardim",
  "author: Enzo Ferrari",
  "---",
  "# O Jardim",
  "",
  "## Capítulo Um",
  "",
  "Era uma manhã clara.",
  "O sol nascia devagar.",
  "",
  "—Bom dia — disse ela.",
  "",
  "---",
  "",
  "## Capítulo Dois",
  "",
  "### Uma nota",
  "",
  "Outro dia começou.",
]

export const LINE = {
  bookTitle: 4,
  chapterUm: 6,
  proseRun: 8,
  dialogue: 11,
  separator: 13,
  chapterDois: 15,
  hashRun: 17,
  lastPara: 19,
} as const
