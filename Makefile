.PHONY: install run check

install:
	npm install

run:
	@echo "Starting game at http://localhost:8080 and room server at ws://localhost:28084"
	@npm run rooms & npm run server

check:
	npm run verify
