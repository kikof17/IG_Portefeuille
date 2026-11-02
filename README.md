# Portefeuille IG

Premier prototype d'une application personnelle de gestion de portefeuille
**IG compte-titres**. L'interface propose une expérience sombre, sobre et
orientée décision, avec une saisie entièrement locale.

## État actuel

Le tableau de bord est une application front-end locale. Aucune clé API,
aucun identifiant, import ni appel externe n'est utilisé.

- synthèse de la valeur, des versements et du cash ;
- historique local de la valorisation, alimenté à chaque opération ou mise à jour de cours ;
- allocation réelle face aux cibles ;
- alertes et prochains points d'attention ;
- aperçu des positions, incluant la poche agrégée QDF ;
- journal des transactions saisies, avec recherche, filtre, duplication, correction et annulation auditée ;
- saisie manuelle des derniers cours par instrument ;
- gestion de la composition QDF : pondérations, rang, ISIN, modification et désactivation des titres ;
- calcul local des positions, PRU, cash, valorisation, allocation et suggestions de rééquilibrage.

Le détail des entités métier se trouve dans [docs/modele-donnees.md](docs/modele-donnees.md).

## Lancer l'application

Installez les dépendances puis démarrez le serveur de développement :

```text
npm install
npm run dev
```

## Utilisation en application Windows

L'application peut aussi tourner en mode desktop (Electron) avec un stockage
fichier local, au lieu du stockage navigateur.

```text
npm run dev:desktop
```

Pour générer un installateur Windows (.exe NSIS) :

```text
npm run dist:win
```

Les artefacts d'installation sont produits dans le dossier [release](release).

### Dossier des données

En mode desktop, les données sont stockées dans un fichier JSON, dans un dossier
configurable depuis l'écran Données locales (bouton Changer le dossier de données).

- Par défaut : `%APPDATA%/ig-portefeuille/data/portfolio-data.json`
- Configurable ensuite vers n'importe quel dossier de votre choix

## Source de données

Le compte-titres IG n'est pas pris en charge par l’API publique IG. L’application
fonctionne exclusivement avec les opérations et cours saisis localement.
Aucun identifiant ou secret n'est requis.

Pour construire la version de production :

```text
npm run build
```

