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

### Mise a jour automatique (desktop)

L'application desktop inclut un flux de mise a jour base sur `latest.yml` de GitHub Releases (URL de telechargement direct).

- dans l'app: Donnees locales -> Mises a jour automatiques
- actions disponibles: verifier, telecharger, installer et redemarrer

Pour publier une nouvelle version detectable par l'application:

1. incrementer la version dans [package.json](package.json)
2. creer les artefacts localement:

```text
npm run dist:win
```

3. publier les artefacts du dossier [release](release) dans une Release GitHub avec un tag de version (ex: v0.1.5):

- `Portefeuille IG Setup X.Y.Z.exe`
- `Portefeuille IG Setup X.Y.Z.exe.blockmap`
- `latest.yml`

Important:

- la release doit etre accessible sans authentification depuis la machine cliente
- si le depot/release est prive, la verification auto-update peut echouer avec 401/403/404

Alternative CI/local automatisee (necessite un token GitHub):

```text
npm run dist:win:publish
```

Cette commande utilise electron-builder et publie automatiquement la release.

### Release automatique a chaque changement

Le depot inclut un workflow GitHub Actions [auto-release.yml](.github/workflows/auto-release.yml).

Sur chaque push vers `main`:

1. bump automatique de version patch (`package.json` + `package-lock.json`)
2. build Windows NSIS
3. publication d'une release GitHub `vX.Y.Z` avec:
	- setup `.exe`
	- `.exe.blockmap`
	- `latest.yml`

Ce workflow rend le test/update in-app automatique sans refaire les commandes manuelles a chaque changement.

### Dossier des données

En mode desktop, les données sont stockées dans un fichier JSON, dans un dossier
configurable depuis l'écran Données locales (bouton Changer le dossier de données).

- Par défaut : `%APPDATA%/ig-portefeuille/data/portfolio-data.json`
- Configurable ensuite vers n'importe quel dossier de votre choix

## Versioning des données

Le stockage local est versionné via une enveloppe persistée :

```json
{
	"format": "ig-portefeuille-data",
	"schemaVersion": 2,
	"savedAt": "2026-11-02T07:00:00.000Z",
	"data": { "...": "PortfolioData" }
}
```

La migration v1 -> v2 est automatique au chargement. Les anciennes données
restent compatibles sans action manuelle.

## Préparation backend sauvegarde

Le code expose un point d’extension pour brancher un backend de sauvegarde
sans casser l’exécutable desktop.

- Adapter: `configurePortfolioBackupAdapter(...)` dans [src/App.tsx](src/App.tsx)
- Contrat: méthode `pushSnapshot(payload)` appelée après chaque sauvegarde locale
- Comportement actuel: aucun backend actif par défaut (mode local pur)

## Source de données

Le compte-titres IG n'est pas pris en charge par l’API publique IG. L’application
fonctionne exclusivement avec les opérations et cours saisis localement.
Aucun identifiant ou secret n'est requis.

Pour construire la version de production :

```text
npm run build
```

