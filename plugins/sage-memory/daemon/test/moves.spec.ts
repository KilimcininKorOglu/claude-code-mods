import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { movesOf } from '../../hooks/shared/moves.ts'

/** Each move as `from>to`, with the directories entered before it as `dir/dir:` in front. */
function read(command: string): string[] {
  return movesOf(command).map(move => `${move.dirs.length > 0 ? `${move.dirs.join('/')}:` : ''}${move.from}>${move.to}`)
}

describe('reading the moves of a command', () => {
  test('every command of a chain is read, whichever separator ends it', () => {
    assert.deepEqual(read('git mv a b && mv c d; mv e f || mv g h | cat & mv i j\nmv k l'), ['a>b', 'c>d', 'e>f', 'g>h', 'i>j', 'k>l'])
  })

  test('a cd moves where the later paths are read from, a subshell keeps its cd, and cd - goes back', () => {
    assert.deepEqual(read('cd src && git mv a.ts b.ts && (cd lib && mv c d) && mv e f && cd - && mv g h'), ['src:a.ts>b.ts', 'src/lib:c>d', 'src:e>f', 'g>h'])
    assert.deepEqual(read('{ cd src; mv a b; } && mv c d'), ['src:a>b', 'src:c>d'], 'a group runs in the same shell')
    assert.deepEqual(read('git -C pkg mv a b'), ['pkg:a>b'])
  })

  test('once the shell alone knows the directory, no later move is read', () => {
    for (const command of ['cd "$DIR" && mv a b', 'cd && mv a b', 'cd ~/src && mv a b', 'pushd +1 && mv a b', 'popd && mv a b', 'cd - && mv a b']) {
      assert.deepEqual(read(command), [], command)
    }
    assert.deepEqual(read('mv a b && cd $X && mv c d'), ['a>b'], 'the moves before it stand')
  })

  test('a path loses its quotes, and a word the shell expands is not read as a path', () => {
    assert.deepEqual(read(`mv 'my file.ts' "other file.ts"`), ['my file.ts>other file.ts'])
    assert.deepEqual(read('mv a\\ b c'), ['a b>c'])
    assert.deepEqual(read('mv a#1 b'), ['a#1>b'], 'a # inside a word starts no comment')
    for (const command of ['mv $SRC b', 'mv a "$(pwd)/b"', 'mv *.ts lib', 'mv a{,.bak}', 'mv ~/a b', 'mv `ls` b', 'mv "a$x" b']) {
      assert.deepEqual(read(command), [], command)
    }
  })

  test('the text of a quote, a comment or a here-document is not a command', () => {
    assert.deepEqual(read(`echo "mv a b" && git commit -m 'git mv c d'`), [])
    assert.deepEqual(read('# mv a b\nmv c d # mv e f'), ['c>d'])
    assert.deepEqual(read("cat > run.sh <<'EOF'\nmv build dist\nEOF\nmv x y"), ['x>y'])
    assert.deepEqual(read('cat <<-EOF > run.sh\n\tmv build dist\n\tEOF\nmv x y'), ['x>y'], '<<- ends at a delimiter led by tabs')
    assert.deepEqual(read("git commit -m \"$(cat <<'EOF'\nfix(core): mv a b\nEOF\n)\" && mv c d"), ['c>d'])
  })

  test('a redirection and the word it names are not operands', () => {
    for (const command of ['git mv a b 2>&1', 'mv a b > /dev/null 2>&1', 'mv a b &>log', 'mv a b>log', 'mv a b 2>> err.log']) {
      assert.deepEqual(read(command), ['a>b'], command)
    }
  })

  test('a move of one source to one target is read, with the flags that take no value', () => {
    assert.deepEqual(read('mv -f -v a b'), ['a>b'])
    assert.deepEqual(read('mv -- -a b'), ['-a>b'])
    assert.deepEqual(read('git mv -k --verbose a b'), ['a>b'])
    assert.deepEqual(read('git -c core.quotepath=off mv a b'), ['a>b'])
    for (const command of ['mv -t dir a', 'mv a b c', 'mv --suffix=.bak a b', 'mv -S .bak a b', 'git --no-pager mv a b', 'git mv a']) {
      assert.deepEqual(read(command), [], command)
    }
  })

  test("PowerShell's Move-Item is read by position and by name, in any case", () => {
    assert.deepEqual(read('Move-Item -Path a -Destination b -Force'), ['a>b'])
    assert.deepEqual(read('move-item a b'), ['a>b'])
    assert.deepEqual(read('Move-Item a -Destination b'), ['a>b'])
    assert.deepEqual(read('Move-Item a b -Filter *.ts'), [], 'a parameter it does not know may take a path')
  })

  test('keywords, a negation and variable assignments stand before the command', () => {
    assert.deepEqual(read('if true; then mv a b; fi'), ['a>b'])
    assert.deepEqual(read('LC_ALL=C git mv a b'), ['a>b'])
    assert.deepEqual(read('! mv a b'), ['a>b'])
  })
})
