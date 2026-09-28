.PHONY: install lint typecheck validate test check

install:
	npm install

lint:
	npx eslint --max-warnings 0 .

# Needs .claude/types/ from /plugin-types run inside a Claude Code session in this folder.
typecheck:
	npx tsc -p .

validate:
	claude plugin validate .

test:
	claude plugin test .

check: lint typecheck validate test
