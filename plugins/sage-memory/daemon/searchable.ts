/**
 * The text the search index holds for a memory, and the same split for a query. The index's word
 * tokenizer (`unicode61`) keeps a run of Chinese, Japanese or Korean letters as one token, so
 * `アプリケーションのログは90日間保存した後` was one word and `ログ` found nothing. A run of
 * those letters is split into its overlapping pairs (`ログは` gives `ログ グは`), which a query split
 * the same way matches. An identifier written in camelCase also gives its words (`retryLimit` adds
 * `retry Limit`), as the tokenizer already splits `retry_limit` at the underscore.
 */

/** A letter or mark of the Chinese, Japanese or Korean scripts, the prolonged sound mark `ー` included. */
const CJK_RUN = /(?:(?=[\p{L}\p{M}])[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}])+/gu
const WORD = /[\p{L}\p{N}_]+/gu
const CAMEL = /(\p{Ll}|\p{N})(\p{Lu})/u
const CAMEL_ALL = new RegExp(CAMEL.source, 'gu')

/** A run's overlapping pairs of letters; a run of one letter stays as it is. */
function pairsOf(run: string): string[] {
  const letters = [...run]
  if (letters.length < 2) return [run]
  return letters.slice(0, -1).map((letter, index) => letter + letters[index + 1])
}

/** Every Chinese, Japanese or Korean run of a text as its pairs, set apart by spaces. */
export function splitCjk(text: string): string {
  return text.normalize('NFKC').replace(CJK_RUN, run => ` ${pairsOf(run).join(' ')} `)
}

/** The pairs of each Chinese, Japanese or Korean run of a text, run by run, in order. */
export function cjkPairs(text: string): string[][] {
  return [...text.normalize('NFKC').matchAll(CJK_RUN)].map(match => pairsOf(match[0]))
}

/** The text the index holds: the CJK runs as pairs, and each camelCase identifier followed by its words. */
export function searchableText(text: string): string {
  return splitCjk(text).replace(WORD, word => (CAMEL.test(word) ? `${word} ${word.replace(CAMEL_ALL, '$1 $2')}` : word))
}
