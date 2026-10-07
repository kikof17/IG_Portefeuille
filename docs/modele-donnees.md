# Modèle de données

Le modèle est conçu pour avoir une source de vérité unique : les opérations.
Les positions et les recommandations de rééquilibrage sont des calculs dérivés,
jamais des données saisies indépendamment.

## Entités locales

| Entité | Rôle | Saisie |
|---|---|---|
| `Transaction` | Dépôt, achat, vente, dividende ou frais avec quantité, prix, montant, frais et flux de trésorerie. | Journal local |
| `MarketPrice` | Dernier cours saisi et horodatage de mise à jour. | Écran Cours |
| `AllocationTarget` | Poids cible des poches ETF Monde, Small Caps, Actions et ETF Maison. | Paramètres locaux |
| `RebalancingRules` | Cash minimal, montant minimum d'ordre et nombre de lignes actions. | Paramètres locaux |
| `QdfConstituent` | Composant actif de la poche QDF, classement, secteur, cours et note de thèse. | Gestion QDF |
| `PortfolioData` | Agrégat local regroupant opérations, cours et paramètres. | Navigateur |

## Règles d'identification

- L'ISIN est l'identifiant de référence lorsque disponible.
- Le ticker est conservé pour l'affichage.
- Chaque opération créée dans le journal possède un identifiant local unique.
- Les composants QDF restent des opérations `ETF Maison` et seront agrégés dans
  la future vue de portefeuille.

## Stockage actuel

Les données sont saisies dans le navigateur, sans envoi vers un service
externe. Elles sont stockées localement dans `localStorage` sous la clé
`ig-portefeuille-data`.

Les corrections, annulations et mises à jour de cours sont conservées dans un
journal d'audit. Le compte-titres IG n'étant pas compatible avec l'API publique,
aucune connexion à IG n'est utilisée.