# Backend dependency lockfiles.
#
# pyproject.toml holds the version RANGES (the source of truth). requirements.txt (runtime) and
# requirements-dev.txt (runtime + dev) are the PINNED, hash-verified locks compiled from it, and
# are what the Dockerfile and CI install. Regenerate them on Python 3.14 (the target the locks
# resolve for) whenever you change a dependency in pyproject.toml:
#
#   make lock            # recompile at the newest versions the current ranges allow
#   make lock-upgrade    # same, but bump every dep to the latest its range permits
#
# Needs GNU make. On a platform without it (e.g. a plain Windows shell), run the pip-compile
# command printed at the top of each generated file instead - it's the exact same invocation.
# Then commit requirements.txt + requirements-dev.txt with the pyproject change.
.PHONY: lock lock-upgrade

PIP_COMPILE = pip-compile --generate-hashes --strip-extras

lock:
	pip install pip-tools
	$(PIP_COMPILE) -o requirements.txt pyproject.toml
	$(PIP_COMPILE) --extra dev -o requirements-dev.txt pyproject.toml

lock-upgrade:
	pip install pip-tools
	$(PIP_COMPILE) --upgrade -o requirements.txt pyproject.toml
	$(PIP_COMPILE) --upgrade --extra dev -o requirements-dev.txt pyproject.toml
