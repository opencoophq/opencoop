# OpenCoop One-Pager Migration (Briefing Fédération)

*Pour Rescoop Vlaanderen / Rescoop Wallonie et les coopératives membres*

---

## Objectif

Permettre à une coopérative de passer d'Excel ou d'un outil legacy vers OpenCoop avec un risque limité, une continuité complète des données et des responsabilités claires.

## Ce qui est migré

- Profils des coopérateurs (personnes physiques, entreprises, mineurs)
- Historique du registre des actions (souscriptions, transferts, sorties)
- Structure des projets et classes d'actions
- Historique des dividendes et champs fiscaux pertinents
- Documents clés et métadonnées de communication (si disponibles)

## Principes de migration

- **Pas de boîte noire** : la cartographie des données est documentée et partagée avant import.
- **Validation d'abord** : les totaux et volumes sont vérifiés avant mise en production.
- **Cutover sécurisé** : les fichiers historiques restent disponibles pendant la vérification.
- **Pas de dépendance** : OpenCoop est sous AGPL-3.0 et orienté export.

## Processus en 4 étapes

### 1) Discovery (Semaine 1)
- Inventaire des sources (fichiers Excel, exports, dossiers documentaires)
- Atelier de mapping (champs OpenCoop vs. champs legacy)
- Analyse des risques (doublons, IBAN manquants, e-mails de ménage, cas limites)

### 2) Import pilote (Semaine 2)
- Import dans un environnement de staging
- Contrôles qualité :
  - nombre de coopérateurs
  - total des parts par classe
  - totaux des transactions historiques
  - totaux de dividendes (brut/taxe/net)
- Partage d'un rapport d'écarts et traitement des exceptions

### 3) Migration finale + cutover (Semaine 3)
- Gel des mises à jour legacy pendant la fenêtre de cutover convenue
- Exécution de l'import final
- Checklist de validation du conseil :
  - totaux concordants
  - échantillonnage contrôlé
  - accès portail confirmé
  - documents clés disponibles

### 4) Hypercare (Semaines 4-6)
- Points hebdomadaires avec le conseil
- Support prioritaire sur les questions de données
- Ajustements mineurs de configuration et de templates de communication

## Rôles et responsabilités

| Partie | Responsabilité |
|------|----------------|
| Conseil de la coopérative | Fournit les fichiers source, confirme les règles métier, valide les contrôles |
| Équipe OpenCoop | Mapping, scripts d'import, contrôles qualité, support de mise en production |
| Fédération (optionnel) | Coordonne la cohorte pilote et partage les retours entre coopératives |

## Calendrier typique

- **Petite coopérative (jusqu'à 500 coopérateurs) :** 2-3 semaines
- **Coopérative moyenne (500-2 000 coopérateurs) :** 3-5 semaines
- **Historique complexe / sources multiples :** 5+ semaines

## Critères de réussite

- 100 % des enregistrements coopérateurs transférés
- Totaux des parts identiques à la source legacy au moment du cutover
- Historique des dividendes validé sur les années convenues
- Le conseil gère les opérations quotidiennes sans tableurs
- Les membres accèdent en self-service au portail (transactions, dividendes, documents)

## Inquiétudes fréquentes (et contrôles)

- **« Et si les données sont incohérentes ? »**  
  Les anomalies sont identifiées en staging et résolues avant l'import production.
- **« Et si nous devons revenir en arrière ? »**  
  Les fichiers legacy restent intacts ; le cutover ne se fait qu'après validation du conseil.
- **« Quid de la confidentialité et du contrôle ? »**  
  Gestion des données adaptée au contexte coopératif belge, accès par rôles, transparence open source.

## Prochaine étape

Désigner une coopérative pilote et planifier un appel discovery migration de 60 minutes.
