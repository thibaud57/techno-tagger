#!/usr/bin/env bash
# Diagnostic d'environnement au demarrage de session.
# Ne bloque jamais : toute sortie est un exit 0, un diagnostic casse ne doit pas
# empecher de travailler.

set -u

if ! command -v just > /dev/null 2>&1; then
    echo "⚠️ just non installe : les recettes du projet sont indisponibles"
    exit 0
fi

# just check est la source de verite unique : runtimes, dependances, binaire du
# sidecar. Ne rien dupliquer ici, sinon les deux divergent.
OUTPUT="$(just check 2>&1 || true)"
[ -n "$OUTPUT" ] && echo "$OUTPUT"

# Sans warning, sortie stdout seule : rien a demander a Claude.
if ! echo "$OUTPUT" | grep -q "⚠️"; then
    exit 0
fi

if ! command -v jq > /dev/null 2>&1; then
    exit 0
fi

jq -nc --arg blocages "$OUTPUT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: (
      "Le diagnostic de demarrage a releve des blocages sur l environnement local :\n\n"
      + $blocages
      + "\n\nAvant toute tache qui construit, lance ou empaquette le projet : enumerer ces blocages a l utilisateur, proposer le correctif correspondant (just install pour des dependances manquantes, just build-sidecar pour le binaire du sidecar, cp .env.example .env si un secret de build est requis), et attendre sa confirmation. Ne pas tenter de contourner un blocage en modifiant une version dans un manifeste."
    )
  }
}'

exit 0
