MARKETPLACE := .claude-plugin/marketplace.json
TEMPLATE    := templates/mod
PLUGINS     := $(wildcard plugins/*)

.PHONY: help validate test new-mod clean

help:
	@echo "make validate                        validate the marketplace and every mod (strict)"
	@echo "make test                            run every mod's tests"
	@echo "make new-mod NAME=x DESC='...'       scaffold plugins/x from $(TEMPLATE) and register it"
	@echo "make clean                           remove node_modules and generated types"

validate:
	claude plugin validate --strict .
	@set -e; for p in $(PLUGINS); do claude plugin validate --strict $$p; done

test:
	@set -e; for p in $(PLUGINS); do \
		if [ -d $$p/tests ]; then claude plugin test $$p; fi; \
	done

new-mod:
	@test -n "$(NAME)" || { echo "NAME is required"; exit 1; }
	@test -n "$(DESC)" || { echo "DESC is required"; exit 1; }
	@echo "$(NAME)" | grep -Eq '^[a-z0-9][a-z0-9-]*$$' || { echo "NAME must be kebab-case"; exit 1; }
	@test ! -e plugins/$(NAME) || { echo "plugins/$(NAME) already exists"; exit 1; }
	mkdir -p plugins
	cp -R $(TEMPLATE) plugins/$(NAME)
	find plugins/$(NAME) -type f -exec perl -pi -e 's/MOD_NAME/$$ENV{NAME}/g; s/MOD_DESCRIPTION/$$ENV{DESC}/g' {} +
	jq --arg n "$(NAME)" --arg d "$(DESC)" \
		'.plugins += [{name: $$n, source: ("./plugins/" + $$n), description: $$d, category: "development", tags: ["mods", "function-hooks", "hooks-module"]}]' \
		$(MARKETPLACE) > $(MARKETPLACE).tmp && mv $(MARKETPLACE).tmp $(MARKETPLACE)

new-mod: export NAME := $(NAME)
new-mod: export DESC := $(DESC)

clean:
	rm -rf node_modules plugins/*/node_modules plugins/*/.claude/types templates/mod/.claude/types
