"""Point d'entree du sidecar : boucle de commandes NDJSON sur les flux standard.

stdin porte les commandes, stdout les evenements. stderr reste aux logs et n'est
jamais melange au protocole.
"""

import sys


def main() -> None:
    # Sans flush, stdout est bufferise des qu'il n'est plus un terminal : les
    # evenements partiraient par paquets en fin de run. Invisible en dev.
    for _line in sys.stdin:
        # TODO: implement, valider la commande contre son modele Pydantic
        # (protocol.py), la dispatcher, puis emettre les evenements produits.
        sys.stdout.flush()


if __name__ == "__main__":
    main()
