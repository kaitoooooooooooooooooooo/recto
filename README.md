# Recto

Réviser une liste de mots, simplement. On colle sa liste, puis on la travaille en mode **Cartes**
ou **Apprendre**. Noir et blanc, sans publicité, sans dépendance.

En ligne : <https://kaito-lab.ch/recto/>

## Ce que ça fait

- **Import par copier-coller** : un export Quizlet, Excel ou Google Sheets se colle tel quel.
  Le séparateur entre terme et définition est deviné (tabulation, « - », « : », « = », virgule),
  l'aperçu se met à jour en tapant.
- **Cartes** : retourner (clic, Espace), trier « Je sais / À revoir » (← →, ou glisser sur téléphone),
  puis revoir seulement les cartes à revoir. Mélangé par défaut.
- **Apprendre** : la liste est découpée en **paliers** d'environ 7 cartes, travaillés l'un après
  l'autre. Une carte nouvelle se présente en choix multiple, puis il faut écrire la réponse ; une
  erreur la fait revenir en fin de manche. Ordre de la liste ou mélangé (le mélange est gardé d'une
  séance et d'un appareil à l'autre).
- **Correction des réponses écrites**, au choix :
  - *souple* : fautes de frappe, accents, ponctuation et article oublié pardonnés ;
  - *normale* : accents et ponctuation ignorés, mais aucune faute ;
  - *stricte* : orthographe exacte, accents compris.

  Ce qui est entre parenthèses est toujours facultatif, et « / » ou « ; » séparent plusieurs réponses
  possibles. Une réponse acceptée avec une remarque peut être comptée fausse (touche F).
- **Favoris et cartes difficiles** : une étoile sur chaque carte (touche E). Dans la liste, une carte
  ratée 2 fois ou plus en mode Apprendre passe en orange, ratée au moins une fois sur deux en rouge.
  On peut réviser seulement ses favoris, ou seulement les cartes difficiles.
- **Progression visible** : anneaux animés, un anneau par palier, et des mini-succès par liste
  (premier palier, sans faute, séries de bonnes réponses, liste maîtrisée, plusieurs jours de révision…).
- **Compte facultatif** : sans compte, les listes restent dans le navigateur. Avec un compte, elles
  suivent sur tous les appareils ; les listes faites sans compte rejoignent le compte à la connexion.

## Structure

```
site/                 l'application, telle qu'elle est mise en ligne
  index.html, app.css
  js/                 modules JavaScript, sans outil de compilation
    parse.js          lecture des listes collées
    check.js          correction des réponses écrites (souple, normale, stricte)
    learn.js          niveaux, paliers, manches, mélange
    achievements.js   mini-succès
    marks.js          favoris et cartes difficiles
    store.js, api.js  enregistrement (navigateur ou compte)
    views/            un écran par fichier (accueil, import, liste, Cartes, Apprendre, compte)
  api/                API PHP : comptes et listes (SQLite)
  fonts/              Archivo et IBM Plex Mono (licence OFL)
tests/                tests (node:test) : logique et API
```

## En local

Il faut PHP 8.1 ou plus récent (avec `pdo_sqlite`) et Node 22 ou plus récent pour les tests.

```bash
php -S localhost:5191 -t site
```

Puis <http://localhost:5191/>. La base SQLite se crée toute seule dans `site/api/data/` ; pour la
garder ailleurs, définir `RECTO_DATA_DIR` (par exemple un dossier `.local-data/`, ignoré par git).

```bash
npm test
```

Les tests lancent l'API sur une base jetable, dans un dossier temporaire.

## Mise en ligne

Copier le contenu de `site/` dans un dossier du site (par exemple `/recto/`) sur un hébergement
Apache avec PHP 8.1+. Les fichiers `.htaccess` protègent le code de l'API et le dossier des données.

- **HTTPS est obligatoire pour les comptes** : sans lui, l'API refuse de répondre (les mots de passe
  circuleraient en clair) et l'application fonctionne sans compte.
- Ne jamais déposer `api/data/` d'une autre machine : la base et la clé secrète y sont créées sur le
  serveur, au premier compte.
- La base contient les comptes (mots de passe hachés avec Argon2id), les sessions (seule leur
  empreinte est gardée) et les listes. Pas d'e-mail envoyé, pas de traceur.

## Sécurité, en bref

Cookie de session `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS ; les requêtes qui écrivent exigent un
en-tête maison et du JSON (protection contre les requêtes venues d'un autre site) ; limites d'essais
de connexion par appareil et par compte ; politique de sécurité du contenu (CSP) stricte sur la page.

## Polices

Archivo (Omnibus-Type) et IBM Plex Mono (IBM), licence SIL Open Font License 1.1 : `site/fonts/OFL-*.txt`.
