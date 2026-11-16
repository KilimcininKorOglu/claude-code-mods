.PHONY: install lint typecheck validate test check bench

# The relevance benchmark: synthetic stores, the real embedding model (after /sage-memory setup) and
# the blocks the hooks really send. SIZE adds generated filler memories; BUILD scores another release.
SIZE ?= 40
BUILD ?= .
bench:
	node --import ./daemon/bench/resolve.mjs daemon/bench/run.ts $(BUILD) --size $(SIZE)
	node --import ./daemon/bench/resolve.mjs daemon/bench/run.ts $(BUILD) --size $(SIZE) --words-only

install:
	npm install

lint:
	npx eslint --max-warnings 0 .

# The daemon runs under Node with built-in TypeScript stripping, so it has a tsconfig of its own with the Node types.
# The hooks module is type-checked by validate.
typecheck:
	npx tsc -p daemon

# --strict fails on warnings, and type errors against the running build's types are warnings.
validate:
	claude plugin validate --strict .

# The daemon's tests are *.spec.ts, because claude plugin test loads every *.test.ts in the folder as a hooks test.
test:
	claude plugin test .
	node --test 'daemon/test/*.spec.ts'

check: lint typecheck validate test
