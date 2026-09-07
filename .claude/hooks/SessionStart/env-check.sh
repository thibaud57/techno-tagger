#!/usr/bin/env bash
# Diagnostic d'environnement au demarrage de session.
# Ne bloque jamais : toute sortie est un exit 0, un diagnostic casse ne doit pas
# empecher de travailler.

set -u

# En premier : plusieurs bash.exe cohabitent sous Windows, celui de Git et le lanceur WSL de
# System32. `just` prend le premier du PATH Windows, et si c'est WSL aucune recette ne demarre.
# A tester avant tout le reste : l'echec (`execvpe(/bin/bash) failed`) ne dit pas pourquoi.
if command -v where.exe > /dev/null 2>&1; then
    FIRST_BASH="$(where.exe bash 2> /dev/null | head -1 | tr -d '\r')"
    case "$FIRST_BASH" in
        *System32* | *WindowsApps*)
            echo "⚠️ bash resout vers '$FIRST_BASH' (lanceur WSL) : placer 'C:\\Program Files\\Git\\bin' avant System32 dans le PATH, sinon aucune recette just ne s execute"
            exit 0
            ;;
    esac
fi

if ! command -v just > /dev/null 2>&1; then
    echo "⚠️ just non installe : les recettes du projet sont indisponibles"
    exit 0
fi

# just check est la source de verite unique : runtimes, dependances, binaire du
# sidecar. Ne rien dupliquer ici, sinon les deux divergent.
OUTPUT="$(just check 2>&1)"
STATUS=$?

# `check` ne signale jamais rien de lui-meme : s'il sort non nul, c'est just qui n'a pas
# pu l'executer. Sans ce garde, l'echec passerait pour un environnement sain.
if [ "$STATUS" -ne 0 ]; then
    echo "⚠️ just check a echoue (code $STATUS), l environnement n a pas ete diagnostique :"
    echo "$OUTPUT"
    exit 0
fi

# Sans warning, sortie stdout seule : rien a demander a Claude.
if ! echo "$OUTPUT" | grep -q "⚠️"; then
    [ -n "$OUTPUT" ] && echo "$OUTPUT"
    exit 0
fi

# A partir d'ici stdout doit rester du JSON pur : un prefixe texte rend le bloc
# impossible a parser, `additionalContext` est ignore et l'objet recrache verbatim.
if ! command -v jq > /dev/null 2>&1; then
    echo "$OUTPUT"
    exit 0
fi

jq -nc --arg blocages "$OUTPUT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: (
      "Le diagnostic de demarrage a releve des blocages sur l environnement local :\n\n"
      + $blocages
      + "\n\nAvant toute tache qui construit, lance ou empaquette le projet : enumerer ces blocages a l utilisateur, proposer le correctif correspondant (just install pour des dependances manquantes, just build-sidecar pour le binaire du sidecar), et attendre sa confirmation. Ne pas tenter de contourner un blocage en modifiant une version dans un manifeste."
    )
  }
}'

exit 0
