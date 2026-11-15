.PHONY: install lint validate test check

install:
	npm install

lint:
	npx eslint --max-warnings 0 .

# --strict fails on warnings, and type errors against the running build's types are warnings.
validate:
	claude plugin validate --strict .

test:
	claude plugin test .

check: lint validate test
