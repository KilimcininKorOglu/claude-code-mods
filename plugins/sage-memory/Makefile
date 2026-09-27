.PHONY: install lint typecheck validate test check

install:
	npm install

lint:
	npx eslint --max-warnings 0 .

# The hooks module needs .claude/types/ from /plugin-types run inside a Claude Code session in this folder.
# The daemon runs under Node with built-in TypeScript stripping, so it has a tsconfig of its own with the Node types.
typecheck:
	npx tsc -p .
	npx tsc -p daemon

validate:
	claude plugin validate .

# The daemon's tests are *.spec.ts, because claude plugin test loads every *.test.ts in the folder as a hooks test.
test:
	claude plugin test .
	node --test 'daemon/test/*.spec.ts'

check: lint typecheck validate test
