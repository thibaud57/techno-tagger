"""Cache disque des reponses API et des pochettes.

Le dossier est jetable a tout moment, y compris en plein run : seuls des appels
reseau sont a repayer.
"""

# TODO: implement, TTL 30 jours, plafond 500 Mo, eviction LRU.
