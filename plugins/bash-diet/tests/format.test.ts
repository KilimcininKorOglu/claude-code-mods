import { describe, expect, test, tier } from 'claude-code/testing'

import type { FilterResult } from '../hooks/filters/common.ts'
import { planFor, runFilter } from '../hooks/pipeline.ts'

tier('user')

/** Runs a command's output through its plan, as the hook does. */
function planned(command: string, text: string, exitCode = 0): FilterResult {
  const plan = planFor(command)
  if (plan === undefined) throw new Error(`no plan for ${command}`)
  return runFilter(plan, text, exitCode, false)
}

// Captured from gofmt 1.2x, rustfmt 1.8 and black 25 over small unformatted files.
const RUST_DIFF = (file: string): string => `Diff in ${file}:1:\n-fn main(){let x=1;println!("{}",x);}\n-fn f( a:i32 )->i32{a+1}\n+fn main() {\n+    let x = 1;\n+    println!("{}", x);\n+}\n+fn f(a: i32) -> i32 {\n+    a + 1\n+}\n \n`
const GO_DIFF = 'diff a.go.orig a.go\n--- a.go.orig\n+++ a.go\n@@ -1,5 +1,7 @@\n package main\n+\n import "fmt"\n-func main(){\n-fmt.Println( "hi" )\n+\n+func main() {\n+\tfmt.Println("hi")\n }\n'
const BLACK_DIFF = '--- pkg/app.py\t2026-09-25 16:36:46.122215+00:00\n+++ pkg/app.py\t2026-09-25 16:36:50.065744+00:00\n@@ -1,14 +1,20 @@\n import os, sys\n import json\n-def f( a,b ):\n-    x=1\n+\n+\n+def f(a, b):\n+    x = 1\n     unused = 2\nwould reformat pkg/app.py\n\nAll done! ✨ 🍰 ✨\n1 file would be reformatted.\n'

describe('formatters', () => {
  test('a check diff reads as each file with the lines it would add and remove, and keeps the full output', () => {
    const r = planned('cargo fmt --check', RUST_DIFF('/p/src/main.rs') + RUST_DIFF('/p/src/lib.rs'), 1)
    expect(r).toEqual({ text: 'cargo fmt: 2 files not formatted\n  /p/src/main.rs  +7 -2\n  /p/src/lib.rs  +7 -2', elided: true })
    expect(planned('rustfmt --check src/main.rs', RUST_DIFF('src/main.rs'), 1).text).toBe('rustfmt: 1 file not formatted\n  src/main.rs  +7 -2')
    expect(planned('gofmt -d a.go', GO_DIFF, 1).text).toBe('gofmt: 1 file not formatted\n  a.go  +4 -2')
    expect(planned('black --diff pkg/app.py', BLACK_DIFF, 0).text).toBe('black: 1 file not formatted\n  pkg/app.py  +4 -2\nwould reformat pkg/app.py\n1 file would be reformatted.')
  })

  test('a file list is capped, a parse error stays, black drops its emoji, and plain gofmt prints the source as it is', () => {
    const files = Array.from({ length: 30 }, (_, i) => `pkg/f${i}.go`)
    const list = planned('gofmt -l .', `${files.join('\n')}\nbad.go:2:6: expected 'IDENT', found '{'\n`, 2)
    expect(list.text.split('\n').slice(-2)).toEqual(['pkg/f19.go', '… +11 more'])
    expect(list.elided).toBe(true)
    expect(planned('black --check pkg', 'would reformat /t/pkg/util.py\nwould reformat /t/pkg/app.py\n\nOh no! 💥 💔 💥\n2 files would be reformatted, 1 file would be left unchanged.\n', 1).text)
      .toBe('would reformat /t/pkg/util.py\nwould reformat /t/pkg/app.py\n2 files would be reformatted, 1 file would be left unchanged.')
    expect(planned('gofmt a.go', 'package main\n\nimport "fmt"\n').text).toBe('package main\n\nimport "fmt"')
  })
})
