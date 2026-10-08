# Guide : mettre en ligne et installer l'appli Budget

Durée : 15 à 20 minutes, une seule fois. Fais-le depuis un **ordinateur** pour les parties 1 à 3, puis sur ton **iPhone** pour la partie 4.

Ce dont tu as besoin : le fichier `budget.zip`, une adresse e-mail, ton iPhone.

---

## Partie 1 : préparer les fichiers

1. Télécharge `budget.zip` sur ton ordinateur.
2. Double-clique dessus pour le décompresser. Tu obtiens un dossier `budget` qui contient :
   `index.html`, `style.css`, `app.js`, `sw.js`, `manifest.json`, `GUIDE.md` et un dossier `icons`.

> Ne renomme aucun fichier : l'appli les cherche par leur nom exact.

---

## Partie 2 : créer ton compte GitHub (gratuit)

GitHub est un site qui stocke du code. Son service **GitHub Pages** transforme ce code en site web, gratuitement et sans carte bancaire. Il ne voit jamais tes dépenses : elles restent dans ton téléphone.

1. Va sur **github.com** et clique sur **Sign up**.
2. Saisis ton e-mail, un mot de passe et un **nom d'utilisateur**. Choisis-le bien : il fera partie de l'adresse de ton appli (par exemple `tonnom.github.io/budget`).
3. Valide le petit test anti-robot, puis le code reçu par e-mail.
4. Si on te propose une offre, choisis **Free** (gratuit). Saute les questions facultatives.

---

## Partie 3 : déposer les fichiers et activer le site

### 3.1 Créer le dépôt
Un **dépôt** (« repository ») est simplement un dossier en ligne pour ton projet.

1. Une fois connecté, clique sur le **+** en haut à droite, puis **New repository**.
2. **Repository name** : `budget` (en minuscules).
3. Laisse **Public** coché. C'est obligatoire pour GitHub Pages gratuit. Seul le code est public, jamais tes données.
4. Ne coche rien d'autre (pas de README). Clique sur **Create repository**.

### 3.2 Envoyer les fichiers
1. Sur la page qui s'affiche, clique sur le lien **uploading an existing file**.
2. Ouvre ton dossier `budget` décompressé, **sélectionne tout son contenu** (les fichiers ET le dossier `icons`) et fais-le glisser dans la zone de la page.
3. Vérifie dans la liste qui apparaît que tu vois bien `icons/icon-192.png`, `icons/icon-512.png` et `icons/apple-touch-icon.png`. Si le dossier `icons` n'est pas passé, glisse-le à nouveau seul.
4. En bas, clique sur le bouton vert **Commit changes** (« enregistrer les changements »).

> Important : glisse le **contenu** du dossier, pas le dossier `budget` lui-même. Sur GitHub, `index.html` doit apparaître directement dans la liste, pas dans un sous-dossier.

### 3.3 Activer GitHub Pages
1. Dans ton dépôt, clique sur l'onglet **Settings** (roue dentée, en haut).
2. Dans le menu de gauche, clique sur **Pages**.
3. Sous **Build and deployment**, choisis **Source : Deploy from a branch**.
4. Dans **Branch**, choisis **main**, laisse **/ (root)**, et clique sur **Save**.
5. Attends 1 à 2 minutes, puis recharge la page. Un encadré affiche : *Your site is live at* `https://tonnom.github.io/budget/`.
6. Clique sur ce lien depuis l'ordinateur pour vérifier que l'appli s'ouvre. Envoie-toi ce lien (par e-mail ou message) pour l'ouvrir sur l'iPhone.

---

## Partie 4 : installer l'appli sur ton iPhone

1. Ouvre le lien **dans Safari** (pas dans Chrome ni depuis l'aperçu d'une autre appli : si tu ouvres le lien depuis un message, appuie sur l'icône boussole pour basculer dans Safari).
2. Appuie sur le bouton **Partager** (le carré avec une flèche vers le haut).
3. Fais défiler et choisis **Sur l'écran d'accueil**, puis **Ajouter**.
4. **À partir de maintenant, ouvre toujours l'appli depuis cette icône**, jamais depuis Safari.

> ⚠️ Pourquoi c'est indispensable :
> - Sur iPhone, Safari peut effacer les données d'un site peu visité. Une appli installée sur l'écran d'accueil est protégée.
> - L'iPhone sépare les données de l'icône et celles de Safari : des dépenses saisies dans Safari ne sont **pas** visibles depuis l'icône, et inversement.

### Premier lancement
1. Ouvre l'appli depuis l'icône.
2. Va dans **Réglages** et indique tes montants : Loyer, Location voiture, Essence (touche une enveloppe pour la modifier).
3. Fais tout de suite une première sauvegarde (voir ci-dessous) pour vérifier que ça marche.

À partir de là, l'appli fonctionne **sans internet**.

---

## Sauvegarder et restaurer tes données

Tes données ne sont que dans ton téléphone. Si tu le perds ou si tu supprimes l'icône, elles disparaissent. La sauvegarde est ton filet de sécurité. L'appli te le rappelle si tu n'en as pas fait depuis 30 jours.

**Sauvegarder** : Réglages, **Exporter mes données**, puis **Enregistrer dans Fichiers** et choisis **iCloud Drive** (ainsi la sauvegarde survit même à la perte du téléphone).

**Restaurer** : Réglages, **Importer mes données**, puis choisis le fichier `budget-sauvegarde-....json`. L'appli te demande de confirmer avant de remplacer quoi que ce soit.

> Ne supprime jamais l'icône de l'appli sans avoir exporté juste avant : supprimer l'icône supprime les données.

---

## Guide de mise à jour (quand on modifiera l'appli)

Le **service worker** (le fichier `sw.js`) garde une copie de l'appli dans ton téléphone pour qu'elle marche hors connexion. Pour qu'il récupère une nouvelle version, il faut lui signaler le changement en modifiant un numéro. C'est l'étape à ne jamais oublier.

1. **Sauvegarde tes données** depuis l'appli (Exporter), par précaution.
2. Sur github.com, ouvre ton dépôt `budget`.
3. **Remplacer des fichiers modifiés** : clique sur **Add file**, puis **Upload files**, glisse les nouveaux fichiers (même nom : ils remplacent les anciens), puis **Commit changes**.
   Ou, pour une petite modification : clique sur le fichier, puis sur le **crayon** (Edit), modifie, puis **Commit changes**.
4. **Changer le numéro de version** : clique sur `sw.js`, puis sur le crayon. Tout en haut, change
   `const VERSION_CACHE = 'budget-v1';` en `'budget-v2'` (puis `v3` la fois suivante, etc.), et **Commit changes**.
5. Attends 1 à 2 minutes (l'onglet **Actions** du dépôt affiche une coche verte quand c'est en ligne).
6. Sur l'iPhone, **avec internet** : ouvre l'appli, ferme-la complètement (glisse vers le haut depuis le bas de l'écran et balaie l'appli), puis rouvre-la. Elle se recharge toute seule avec la nouvelle version. Si rien ne change, recommence une fois.

Tes données ne sont pas touchées par une mise à jour.

---

## En cas de problème

- **La page affiche une erreur 404** : attends encore 2 minutes ; vérifie que `index.html` est bien à la racine du dépôt (pas dans un sous-dossier) et que GitHub Pages est sur la branche `main`.
- **Pas d'icône sur l'écran d'accueil** : vérifie que le dossier `icons` a bien été envoyé avec ses 3 images.
- **« Impossible d'accéder au stockage du téléphone »** : Safari est peut-être en navigation privée. Ouvre l'appli depuis l'icône.
- **La mise à jour n'apparaît pas** : vérifie que tu as bien changé le numéro dans `sw.js`, puis ferme et rouvre l'appli deux fois avec internet.

---

## Confidentialité

L'appli n'envoie rien sur internet : pas de compte, pas de traceur, pas de statistiques de visite. GitHub ne fait que livrer les fichiers de l'appli ; tes dépenses restent dans ton iPhone et dans les sauvegardes que tu choisis de faire.
