# Puerto Rico — Édition Web

> Une adaptation solo du grand classique de stratégie, jouable dans le navigateur. IA évoluée sur 700+ générations à partir de l'[évolueur Excel Puerto Rico de Tony Mitton (BGG #8766)](https://boardgamegeek.com/filepage/8766/pr-030205zip), avec les règles d'origine Rio Grande 2002.

🌐 **Langue / Language**：[中文](README.md) · [English](README.en.md) · **Français** · [Español](README.es.md)

---

## 🌐 Jouer

### En ligne
**👉 [https://ethan9123.github.io/puerto-rico-web/](https://ethan9123.github.io/puerto-rico-web/) 👈** (GitHub Pages)

### Hors ligne (sans installation, sans serveur)
1. Récupérez l'archive `puerto-rico-web-{date}.zip` (~6,8 Mo).
2. Décompressez-la où vous voulez.
3. **Double-cliquez sur `index.html`** — le jeu s'ouvre dans votre navigateur et démarre aussitôt.

Entièrement hors ligne et permanent : aucun réseau, aucun serveur local, aucune installation. Toutes les IA (y compris l'ADN évolué et le réseau de neurones « Grand Maître »), tous les bâtiments et toutes les règles sont embarqués localement. L'archive ne contient que des fichiers web ordinaires (pas de `.exe` / `.bat` / installeur / macro) : si un antivirus signale un faux positif, vous pouvez sans risque restaurer le dossier et l'ajouter à la liste de confiance.

> 🇨🇳 Les détails d'accès depuis la Chine continentale (GFW, distribution WeChat, déclaration ICP) restent dans le README chinois et dans **[CN-ACCESS.md](CN-ACCESS.md)**.

---

## ✨ Caractéristiques

### 🎮 Jeu complet
- **3 / 4 / 5 joueurs**, avec doublons de départ, réserve de colons, réserve de PV, capacités des navires et nombre de cartes Rôle ajustés automatiquement selon les règles officielles.
- **Les 23 bâtiments** + 5 marchandises + 7 rôles (Colon / Maire / Constructeur / Artisan / Marchand / Capitaine / Prospecteur).
- **Règles fidèles** : plantations de départ distribuées dans l'ordre du gouverneur, premier gouverneur aléatoire, déclencheurs de dernière manche (12 emplacements / réserve de PV / réserve de colons), chargement forcé du Capitaine, privilège de l'Artisan limité à une marchandise produite ce tour, privilège +1 du Maire pour celui qui choisit, etc.
- **Illustrations des bâtiments issues de [BGG 42234 — Anniversary Edition (Greg May)](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated)**.

### 🤖 6 niveaux de difficulté de l'IA (réglables individuellement par CPU)

| Niveau | Nom | Comportement |
|---|---|---|
| **N1** | Débutant (Beginner) | Jeu simple et intuitif, qui mise sur ses points forts : peu de colons → Maire, beaucoup de marchandises → Capitaine, assez d'argent → Constructeur. |
| **N2** | Évolué (DNA) | IA purement ADN, évoluée sur 700+ générations dans l'évolueur VBA de Tony Mitton (5 viviers de siège × 10 chacun = 50 ADN). |
| **N3** | Normal (Normal) | + conscience des bonus des cartes Rôle + blocage des marchandises du voisin aval. |
| **N4** | Difficile (Hard) | + **contre-jeu de blocage sur tout le plateau** (priver l'adversaire du Capitaine / Constructeur / Marchand / Artisan / Maire) + tendances stratégiques à score souple + anticipation par instantané sur 2 niveaux. |
| **N5** | Expert (Expert) | **ISMCTS** (recherche arborescente Monte-Carlo sur ensembles d'information) : déterminisation du paquet caché + UCB1 + simulations heuristiques, réflexion de plus en plus profonde. |
| **N6** | Grand Maître (Grandmaster) | **AlphaZero** : un réseau de neurones entraîné par jeu contre soi-même qui guide le MCTS (politique/valeur du réseau + PUCT). Le plus fort. |

### 🧠 Temps de réflexion de l'IA réglable

Choisissez « temps de réflexion de l'IA » sur l'écran de configuration (budget de recherche pour l'Expert N5 / le Grand Maître N6) :
- 🚀 **Rapide** (0,1 s) — pour regarder les IA s'affronter
- ⚖️ **Normal** (1,5 s)
- 🧠 **Profond** (6 s · défaut) — anticipation sur 2 manches
- 💎 **Extrême** (10 s) — fortement recommandé contre l'IA

Les IA Difficile / Expert / Grand Maître **analysent en temps réel les menaces du joueur humain** (nombre de marchandises, grands bâtiments violets abordables, meilleur prix de vente, capacité de production, emplacements de travailleurs vacants) et prennent les rôles de manière préventive pour les contrer.

### 🎨 Confort de jeu

- **Infobulles au survol des bâtiments / rôles** : chaque bâtiment indique coût, PV, emplacements de travailleurs, plafond de remise par carrière et effet complet ; les rôles indiquent action / privilège / timing.
- **Aperçu instantané du Maire** sur la carte (« vous +3 : navire 2 + privilège 1 »), sans survol.
- **État instantané du Capitaine / Marchand** (« navire 1 plein / 2 vide », « maison de commerce 3/4 »).
- **Notifications des actions de l'IA** (en haut à droite) : ce que chaque CPU a choisi, chargé, vendu, produit — d'un coup d'œil.
- **Indications de revenu passif** en vert : phase du Maire « vous +N colons », phase de l'Artisan « vous +X maïs +Y indigo », phase du Capitaine « +X PV expédiés ce tour ».
- **Alerte ⚠ dernière manche** : quand les colons / les PV / la limite des 12 emplacements se déclenchent, l'en-tête affiche « · ⚠ dernière manche » et une notification.
- **Animations FLIP** lors de la prise de plantations / bâtiments.
- **Interface façon BGA** : le marché des bâtiments est disposé en 4 lignes (graduées selon la remise de carrière de 1/2/3/4 doublons).

---

## 📋 Règles en bref

À chaque manche, en commençant par le gouverneur et dans le sens horaire, chaque joueur choisit **un** rôle. L'action de ce rôle est exécutée par **tous** les joueurs (sens horaire), mais **celui qui choisit obtient un privilège supplémentaire**. Chaque carte Rôle non choisie gagne +1 doublon par manche.

| Rôle | Action | Privilège |
|---|---|---|
| 🌾 Colon | Prendre 1 plantation | Peut prendre une carrière à la place |
| 👷 Maire | Distribuer les colons du navire un par un dans le sens horaire jusqu'à épuisement | +1 colon depuis la réserve |
| 🏗 Constructeur | Construire 1 bâtiment | −1 doublon de remise |
| 🏭 Artisan | Tout le monde produit selon sa capacité | +1 d'une marchandise produite ce tour |
| 💰 Marchand | Vendre 1 marchandise à la maison de commerce | +1 doublon |
| 🚢 Capitaine | Charger les navires dans l'ordre (obligatoire), 1 marchandise = 1 PV | +1 PV (une seule fois, cette phase) |
| ⛏ Prospecteur | Aucune | +1 doublon (uniquement celui qui choisit) |

**Fin de partie** (un seul déclencheur suffit → la manche se termine, puis la partie s'arrête) :
- Plus assez de colons pour remplir le navire.
- Un joueur remplit ses 12 emplacements de ville (les grands bâtiments violets en occupent 2).
- La réserve de PV est épuisée.

**Décompte** : jetons PV + PV des bâtiments + PV spéciaux des grands bâtiments violets (qui doivent être occupés) ; égalités départagées par doublons + marchandises.

Règles complètes : [résumé Universal Head](https://www.universalhead.com/games/getting-rules) ou [BoardGameGeek](https://boardgamegeek.com/boardgame/3076/puerto-rico).

---

## 💻 Lancer en local (optionnel)

### Option 1 : double-cliquer sur `index.html` (recommandé)
La stratégie ADN et les poids du réseau de neurones du Grand Maître sont embarqués sous forme de données `<script>` — aucun réseau, aucun serveur, il suffit de double-cliquer.

### Option 2 : serveur HTTP local (pratique pour modifier le code)
```bash
cd puerto-rico-web
python -m http.server 8765
# ou
npx http-server -p 8765 -c-1
```
Ouvrez [http://localhost:8765](http://localhost:8765).

---

## 📁 Structure du projet

```
puerto-rico-web/
├── index.html              ← point d'entrée
├── game.js                 ← logique complète du jeu + 6 niveaux d'IA
├── styles.css              ← interface façon BGA
├── ai_dna.json             ← ADN évolué extrait de l'Excel (5 viviers × 10)
├── ai_dna.js               ← décodeur d'ADN (Évolué / N2)
├── sim.js                  ← moteur de règles « headless » + ISMCTS (Expert / N5)
├── sim_features.js         ← extraction de 446 caractéristiques (Grand Maître / N6)
├── sim_nn.js               ← inférence du réseau de neurones (Grand Maître / N6)
├── mcts_value_nn.json      ← poids AlphaZero (chargés en ligne ; embarqués dans l'archive hors ligne)
├── LICENSE                 ← MIT
├── NOTICE.md               ← note de propriété intellectuelle
├── tests/                  ← vérifications de conservation + auto-parties de bout en bout + assertions
├── tools/                  ← scripts de taux de victoire / calibrage d'échelle / évaluation d'entraînement
└── assets/
    └── buildings/          ← 23 illustrations de bâtiments (issues de BGG 42234)
```

---

## 🛠 Configuration requise

- **N'importe quel navigateur moderne** (Chrome / Edge / Firefox / Safari).
- Le double-clic sur `index.html` fonctionne entièrement hors ligne — **pas besoin** de Python / Node.js (un serveur local n'est utile que pour le rechargement à chaud pendant le développement).
- Résolution recommandée **1280×800+**.

---

## 🧪 Tests automatisés

- **Conservation / auto-parties de bout en bout** (Node, headless) : parties complètes à 3/4/5 joueurs, avec vérification que
  - la partie se termine correctement (colons épuisés / PV épuisés / limite des 12 emplacements),
  - les colons sont conservés (55 / 75 / 95 pour 3/4/5 joueurs),
  - les marchandises sont conservées (maïs 10, indigo 11, sucre 11, tabac 9, café 9),
  - le PV final de chaque joueur > 0,
  - les tables à niveaux mixtes (N1–N6) se classent de façon monotone par score moyen : N6 > N5 > N4 > N3 > N2 > N1,
  - les 23 bâtiments sont construits au moins une fois, et les 7 rôles choisis au moins une fois.
- **Tests unitaires ciblés** : premier gouverneur aléatoire, ordre des plantations de départ, priorité de navire par défaut du Capitaine, bonus de l'Artisan limité aux marchandises produites ce tour, déclencheur de fin sur manche complète, etc.

---

## 🚢 Priorité de navire par défaut du Capitaine (note d'implémentation)

Quand une marchandise peut être chargée sur plusieurs navires candidats, la priorité par défaut est :
1. **Un navire transportant déjà cette marchandise** (continuer à empiler, éviter de disperser).
2. **Le navire vide ayant le plus de capacité restante.**
3. Les autres candidats par **capacité restante décroissante**.

La liste de candidats du joueur place la meilleure option en premier ; l'IA utilise la même priorité.

---

## 📜 Crédits & sources

| Contribution | Source |
|---|---|
| **Conception du jeu original** | Andreas Seyfarth |
| **Éditeur** | Rio Grande Games |
| **Évolueur VBA (source de l'ADN de l'IA)** | [Tony Mitton — BGG #8766](https://boardgamegeek.com/filepage/8766/pr-030205zip) |
| **Illustrations des bâtiments** | [Greg May — Anniversary Edition Buildings, BGG #42234](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated) |
| **Référence des règles** | [aide de jeu Universal Head (PDF)](https://www.universalhead.com/games/getting-rules), [page de règles BGG](https://boardgamegeek.com/boardgame/3076/puerto-rico) |

---

## 📄 Licence & attribution

- Le **code** est publié sous **licence MIT**, voir [`LICENSE`](LICENSE).
- Il s'agit d'une **réimplémentation amateur non commerciale**. La propriété intellectuelle de **Puerto Rico** (nom, mécaniques, expression des règles, etc.) appartient à **Andreas Seyfarth / Rio Grande Games**.
- Les illustrations de bâtiments dans `assets/buildings/` sont la propriété de Rio Grande Games / de l'illustrateur d'origine ; elles sont utilisées uniquement à des fins éducatives / de démonstration pour le jeu personnel et **ne sont pas** couvertes par la licence MIT.
- Ce projet n'a **aucune affiliation officielle ni soutien** de la part d'Andreas Seyfarth ou de Rio Grande Games.
- Voir [`NOTICE.md`](NOTICE.md) pour les détails.
