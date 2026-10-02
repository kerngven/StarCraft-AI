.PHONY: install run check kill

install:
	npm install

run:
	@$(MAKE) --no-print-directory kill
	@echo "Starting game at http://localhost:8080 and room server at ws://localhost:28084"
	@set -e; \
	  npm run rooms & rooms_pid=$$!; \
	  npm run server & game_pid=$$!; \
	  cleanup() { kill "$$rooms_pid" "$$game_pid" 2>/dev/null || true; wait "$$rooms_pid" "$$game_pid" 2>/dev/null || true; }; \
	  trap cleanup INT TERM EXIT; \
	  wait

check:
	npm run verify

kill:
	@for port in 8080 28084; do \
	  for pid in $$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null); do \
	    command=$$(ps -p $$pid -o command=); \
	    case "$$command" in \
	      *"tools/server.js"*|*"tools/room-server.js"*) echo "Stopping project server on :$$port (PID $$pid)"; kill $$pid ;; \
	      *) echo "Leaving non-project process on :$$port (PID $$pid)" ;; \
	    esac; \
	  done; \
	done
