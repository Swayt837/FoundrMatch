# Mise en production — guide pas à pas

De l'état actuel jusqu'aux fiches App Store et Play Store.

Chaque étape indique qui fait quoi : **[TOI]** = tu cliques dans une interface web,
**[MOI]** = c'est du code, demande-le moi, **[LES DEUX]** = je code, tu fournis une valeur.

Les phases 1 à 3 se suivent dans l'ordre. Les phases 4 à 8 sont largement parallèles.

---

## Phase 0 — À lancer aujourd'hui, avant tout le reste

Ces trois points ont des délais d'attente qui ne dépendent pas de nous. Tout le reste
peut avancer pendant qu'ils mûrissent.

### 0.1 ~~Compte Apple Developer~~ — ✅ déjà en place

Le délai le plus long du projet est donc déjà purgé. Deux choses à faire dès maintenant,
parce qu'elles ont elles-mêmes plusieurs jours de latence :

1. **Réserver le bundle identifier.** Certificates, Identifiers & Profiles → Identifiers →
   **+** → App IDs → `com.cofound.app` (ou le nom retenu en 0.3 — c'est **définitif**).
   Coche **Sign In with Apple** dans les capacités au passage, ça évite d'y revenir.
2. **Lancer le contrat Paid Applications.** App Store Connect → Business → *Agreements,
   Tax, and Banking* : signer le contrat et renseigner les coordonnées bancaires et
   fiscales. Le traitement prend souvent plusieurs jours, et **tant qu'il n'est pas
   terminé les achats intégrés de la phase 6 restent bloqués en « Missing Metadata »** —
   impossible même de les tester. C'est le nouveau chemin critique.

### 0.2 [TOI] Compte Google Play Console — 25 $ une seule fois

https://play.google.com/console/signup

⚠️ Point à connaître dès maintenant : pour un **compte développeur personnel** créé
récemment, Google impose un test fermé avec **au moins 12 testeurs inscrits pendant
14 jours consécutifs** avant de pouvoir publier en production. Ce n'est pas contournable.
Si tu ouvres un compte **société** (avec numéro SIRET / D-U-N-S), cette obligation ne
s'applique pas. À arbitrer maintenant, parce que ça change le calendrier de deux semaines.

### 0.3 [TOI] Deux décisions produit

**Le nom.** Le dépôt s'appelle FoundrMatch, l'app s'appelle CoFound partout (nom affiché,
slug, scheme, bundle `com.cofound.app`, textes de l'interface). Il faut trancher avant de
réserver le bundle identifier : **une fois créé sur App Store Connect, il est définitif**.
Vérifie aussi que le nom est libre sur les deux stores et à l'INPI.

**Le prix.** Le code vend 29 $ à vie et 9,99 $/mois ; le PRD parle de ~20 €/mois. Décide
la devise (je recommande l'euro) et les deux montants. À savoir : la commission des stores
est de **15 % tant que tu restes sous 1 M$ de revenus annuels** (App Store Small Business
Program et son équivalent Google, tous deux sur inscription), 30 % au-delà. Un abonnement
à 9,99 € te rapporte donc environ 8,50 € — pense à t'inscrire aux deux programmes, ce
n'est pas automatique.

---

## Phase 0 bis — Faire tourner l'app en local (déjà fait, pour la relancer)

Environnement de développement complet sur ta machine, sans rien déployer. C'est ce qui
est en place actuellement.

**Prérequis** : Docker Desktop démarré, Node et Python installés. `yarn` n'est pas
nécessaire — `npx` suffit partout.

```sh
# 1. Base de données (une seule fois, le conteneur redémarre tout seul ensuite)
docker start cofound-mongo
#    ... ou, si le conteneur n'existe pas encore :
#    docker run -d --name cofound-mongo -p 27017:27017 --restart unless-stopped mongo:7

# 2. Backend — http://localhost:8001
cd backend
.venv/Scripts/python.exe -m uvicorn server:socket_app --host 0.0.0.0 --port 8001

# 3. Frontend — http://localhost:8081 (dans un second terminal)
cd frontend
npx expo start --web
```

Les fichiers `backend/.env` et `frontend/.env` sont déjà créés et gitignorés. Le backend
tourne sans clé Anthropic : le score de compatibilité fonctionne (il est local et
déterministe), seuls les textes générés par l'IA sont désactivés.

Pour recréer les profils de démonstration : `.venv/Scripts/python.exe seed_profiles.py`.

⚠️ **Page blanche sur `localhost:8081` ?** C'est presque toujours le bundle JavaScript qui
a échoué, et non le serveur : Metro renvoie quand même la page HTML en HTTP 200, donc
tester l'URL à la main ne prouve rien. Regarde le terminal Metro, ou récupère le bundle
lui-même (l'URL est dans la balise `<script>` du HTML). Après tout changement de version
d'un paquet, relance avec `npx expo start --web --clear` : le cache de Metro conserve
l'ancienne arborescence du module et provoque des erreurs de résolution fantômes.

⚠️ **`bcrypt` doit rester en 4.1.3.** La version 5.x lève une exception là où passlib 1.7.4
attend une troncature, ce qui casse toute inscription. C'est la version épinglée dans
`requirements.txt` ; ne pas l'installer sans version.

⚠️ Le web ne montre pas tout : les **appels vidéo** utilisent `react-native-webrtc`, un
module natif. Sur navigateur c'est l'implémentation WebRTC du navigateur qui prend le
relais, et sur téléphone il faut un build de développement (phase 9.1) — Expo Go ne suffit
pas.

---

## Phase 1 — La base de données (MongoDB Atlas, ~15 min)

### 1.1 [TOI] Créer le cluster

1. https://cloud.mongodb.com → créer un compte
2. **Build a Database** → offre **M0 (gratuite)** pour commencer
3. Fournisseur AWS, région **eu-central-1 (Frankfurt)** — la même que Render à l'étape 2

Le M0 gratuit offre 512 Mo. Les photos de profil étant stockées en base64 dans les
documents utilisateur, ça se remplit vite : compte environ 300 à 500 utilisateurs avant
de devoir passer au palier suivant (M10, ~9 $/mois).

### 1.2 [TOI] Créer l'utilisateur de base

**Database Access** → **Add New Database User**

- Nom d'utilisateur : `cofound`
- Mot de passe : **Autogenerate Secure Password**, puis **copie-le tout de suite**
- Rôle : `Read and write to any database`

⚠️ Si tu choisis ton propre mot de passe et qu'il contient `@ : / ? # [ ] %`, il faut
l'encoder en URL dans la chaîne de connexion. Le mot de passe généré évite le problème.

### 1.3 [TOI] Ouvrir l'accès réseau

**Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`)

Render ne fournit pas d'adresse IP fixe sur les offres d'entrée, donc on ne peut pas
restreindre par IP. La protection repose sur les identifiants et le chiffrement TLS,
ce qui est le fonctionnement normal d'Atlas.

### 1.4 [TOI] Récupérer la chaîne de connexion

**Connect** → **Drivers** → **Python**. Tu obtiens :

```
mongodb+srv://cofound:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Remplace `<db_password>` par le mot de passe de l'étape 1.2. **Garde tout le reste tel
quel**, y compris les paramètres après le `?`. C'est la valeur de `MONGO_URL`.

Ne mets pas le nom de la base dans l'URL : le code le lit séparément dans `DB_NAME`.

---

## Phase 2 — Le backend sur Render (~30 min)

### 2.1 [TOI] Pousser les fichiers de déploiement

`backend/Dockerfile`, `backend/.dockerignore` et `render.yaml` viennent d'être créés.
Commite-les et pousse sur `main` — Render lit `render.yaml` directement depuis GitHub.

### 2.2 [TOI] Créer le service

1. https://render.com → créer un compte, connecter GitHub
2. **New** → **Blueprint** → sélectionne le dépôt `FoundrMatch`
3. Render détecte `render.yaml` et propose le service `cofound-api`
4. Il demande alors les variables marquées `sync: false` — voir le tableau ci-dessous
5. **Apply**

Le premier build prend 5 à 8 minutes (l'image Docker installe encore beaucoup de
dépendances héritées d'Emergent — voir l'étape 2.5).

### 2.3 [LES DEUX] Les variables d'environnement

Ce que tu saisis dans Render au moment du déploiement :

| Variable | Valeur | Où la trouver |
|---|---|---|
| `MONGO_URL` | la chaîne de l'étape 1.4 | MongoDB Atlas |
| `DB_NAME` | `cofound` | déjà rempli par le blueprint |
| `ALLOWED_ORIGINS` | ton futur domaine web, ex. `https://cofound.app` | à toi de choisir |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | https://console.anthropic.com → API Keys |
| `GOOGLE_CLIENT_IDS` | **laisse vide** | rempli en phase 5 |
| `STRIPE_SECRET_KEY` | **laisse vide** | rempli en phase 6, web uniquement |
| `STRIPE_WEBHOOK_SECRET` | **laisse vide** | idem |
| `STRIPE_PRICE_MONTHLY` | **laisse vide** | idem |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | **laisse vide** | phase 8, appels vidéo |

`SECRET_KEY` est généré automatiquement par Render et n'apparaît jamais dans le dépôt.
Ne le change plus ensuite : le modifier invalide tous les JWT et déconnecte tout le monde.

Laisser une variable vide est sans danger — le code est écrit pour se dégrader proprement.
Sans clé Anthropic, le score de compatibilité continue de fonctionner (il est local et
déterministe) ; ce sont les textes générés qui disparaissent. Sans identifiants Google, le
bouton de connexion Google est masqué au lieu d'être affiché cassé.

⚠️ **Prends l'offre Starter (7 $/mois), pas l'offre gratuite.** Une instance gratuite
s'endort après 15 minutes d'inactivité, ce qui coupe toutes les connexions Socket.io
ouvertes — donc le chat en temps réel et les appels entrants — et ajoute un démarrage à
froid de ~30 secondes à la requête suivante.

### 2.4 [TOI] Vérifier que ça tourne

Dans les logs Render, tu dois voir `✅ Database indexes created`. Ensuite :

```sh
curl https://cofound-api-xjxt.onrender.com/api/health
# {"status":"healthy","service":"CoFound API"}
```

L'URL réellement attribuée est **`https://cofound-api-xjxt.onrender.com`** (Render ajoute un
suffixe quand le nom simple est déjà pris) ; elle est déjà reportée dans `frontend/eas.json`.

⚠️ L'assistant Atlas propose « Add Current IP Address », qui n'autorise que ta connexion
domestique — Render se fait alors couper au niveau TLS, avec un
`SSL: TLSV1_ALERT_INTERNAL_ERROR` sur les trois nœuds du réplica et jamais de message
d'authentification. C'est bien l'étape 1.3 (`0.0.0.0/0`) qu'il faut, et le symptôme ne
ressemble pas du tout à un problème de liste d'accès.

Puis, dans **Shell** sur le tableau de bord Render, crée des profils à swiper :

```sh
python seed_profiles.py
```

### 2.5 [MOI] Alléger l'image Docker

`requirements.txt` contient encore une centaine de paquets hérités de l'image Emergent
— pandas, numpy, boto3, openai, huggingface-hub, les SDK Google Gemini — dont aucun n'est
importé par le code. Le backend n'a réellement besoin que de treize d'entre eux. Nettoyer
divise le temps de build par trois et réduit fortement la surface de sécurité. À faire une
fois le premier déploiement validé, pour ne pas mélanger les causes en cas de problème.

---

## Phase 3 — Brancher l'app sur le backend (~15 min)

### 3.1 [TOI] Initialiser le projet EAS

```sh
cd frontend
npx eas login
npx eas init
```

`eas init` crée le projet côté Expo et écrit `extra.eas.projectId` dans `app.json` —
c'est ce qui manquait pour pouvoir lancer un build. Commite le changement.

### 3.2 ~~Reporter l'URL du backend~~ — ✅ fait

`frontend/eas.json` pointe sur `https://cofound-api-xjxt.onrender.com` dans les profils
`preview` et `production`.

### 3.3 [TOI] Tester en local contre la production

```sh
cd frontend
cp .env.example .env
# mets EXPO_PUBLIC_BACKEND_URL=https://cofound-api-xjxt.onrender.com
yarn install
yarn start
```

Crée un compte, fais l'onboarding, swipe sur les profils créés à l'étape 2.4. Si ça
marche, la chaîne complète app → API → base est validée.

---

## Phase 4 — L'identité visuelle (~1 h, hors création graphique)

### 4.1 [TOI] Produire trois images

| Fichier | Format exigé | Remarque |
|---|---|---|
| `assets/images/icon.png` | **1024×1024, PNG opaque** | actuellement 512×512 **avec transparence** → rejet automatique à l'envoi |
| `assets/images/adaptive-icon.png` | 1024×1024 | Android : garde le motif dans les 66 % centraux, les bords sont rognés |
| `assets/images/splash-image.png` | logo simple sur fond `#000000` | l'actuel est une capture d'écran de 336×729 |

Deux pièges sur l'icône iOS : **aucun canal alpha** (App Store Connect renvoie l'erreur
ITMS-90717) et **pas de coins arrondis dessinés** — Apple les applique lui-même, une icône
pré-arrondie donne un rendu à double bordure.

### 4.2 [MOI] Aligner les noms

`package.json` s'appelle encore `frontend`, et il faut propager le nom retenu en 0.3
partout s'il change (`app.json`, textes de l'interface, `README`).

### 4.3 [MOI] Décider du support iPad

`app.json` déclare `supportsTablet: true`. Conséquence : Apple **exige des captures
d'écran iPad** et teste réellement l'app sur iPad — une interface pensée pour le mobile
qui s'étire mal est un motif de rejet fréquent. Sauf si tu veux vraiment l'iPad au
lancement, je recommande de passer à `false` ; on pourra le réactiver plus tard.

---

## Phase 5 — La connexion (~1 jour de dev)

### 5.1 [TOI] Créer les identifiants Google

https://console.cloud.google.com → nouveau projet

**APIs & Services → OAuth consent screen** : type *External*, nom de l'app, e-mail de
contact, portées `email` et `profile`, puis **Publish**.

**APIs & Services → Credentials → Create OAuth client ID**, trois fois :

| Type | Ce qu'il demande |
|---|---|
| iOS | le bundle identifier (`com.cofound.app`) |
| Android | le nom de paquet **et** l'empreinte SHA-1 |
| Web | rien de particulier |

⚠️ L'empreinte SHA-1 Android doit venir de `npx eas credentials` (le certificat de
signature EAS), **pas** du keystore de debug de ta machine. Se tromper là-dessus donne
une connexion qui fonctionne en développement et échoue dans l'app publiée.

Ensuite :
- les trois identifiants vont dans `frontend/eas.json` (`EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`)
- les trois, séparés par des virgules, vont dans `GOOGLE_CLIENT_IDS` sur Render
- l'identifiant iOS **inversé** doit être déclaré comme schéma d'URL dans `app.json`
  (voir `frontend/.env.example`, qui documente la manipulation exacte)

### 5.2 [MOI] Ajouter « Sign in with Apple »

**Obligatoire** : la règle 4.8 d'Apple impose une option de connexion respectueuse de la
vie privée dès lors que l'app propose une connexion tierce comme Google. Sans elle, rejet
garanti.

Côté code : `expo-apple-authentication` dans l'app, plus la vérification du jeton
d'identité Apple côté backend, sur le même modèle que ce qui existe déjà pour Google.
Compte une demi-journée.

### 5.3 [TOI] Activer la capacité côté Apple

Dans **Certificates, Identifiers & Profiles** → ton App ID → coche **Sign In with Apple**.
À faire après la création du bundle identifier (phase 6.1).

---

## Phase 6 — Les paiements in-app (~3 jours de dev, le plus gros morceau)

C'est le blocage principal. Aujourd'hui l'app ouvre Stripe Checkout dans un navigateur
intégré, ce qui est un rejet certain sous la règle 3.1.1 d'Apple et une violation de la
politique Play Billing. Le backend Stripe reste utilisable **pour le web** ; il faut une
seconde voie pour les applications mobiles.

L'approche recommandée est **RevenueCat** : une seule intégration côté app pour les deux
stores, la gestion des reçus, des renouvellements et de la restauration d'achat, et un
webhook unique vers notre backend. Gratuit jusqu'à 2 500 $ de revenus mensuels.

### 6.1 [TOI] Créer l'app sur App Store Connect

https://appstoreconnect.apple.com → **My Apps** → **+** → bundle `com.cofound.app`.

⚠️ **L'étape que tout le monde oublie** : dans **Business** → **Agreements, Tax, and
Banking**, il faut signer le contrat *Paid Applications* et renseigner les coordonnées
bancaires et fiscales. Tant que ce n'est pas fait, les achats intégrés restent bloqués en
« Missing Metadata » et ne peuvent même pas être testés. Le traitement prend souvent
plusieurs jours.

### 6.2 [TOI] Créer les deux produits, sur chaque store

| Identifiant | Type Apple | Type Google | Prix |
|---|---|---|---|
| `premium_lifetime` | Non-Consumable | Produit unique | 29 € |
| `premium_monthly` | Auto-Renewable Subscription | Abonnement | 9,99 €/mois |

Côté Apple, un abonnement auto-renouvelable doit appartenir à un *Subscription Group* :
crée-en un nommé `Premium`. Chaque produit demande aussi une capture d'écran de revue et
une description.

### 6.3 [TOI] Configurer RevenueCat

https://app.revenuecat.com → nouveau projet, puis connecter les deux stores (Apple demande
une clé d'API App Store Connect, Google un compte de service). Crée ensuite :

- un **Entitlement** nommé `premium`
- une **Offering** contenant les deux produits

### 6.4 [MOI] Le code

Côté app : `react-native-purchases`, avec un aiguillage qui envoie iOS et Android vers
l'achat intégré et le web vers Stripe. Côté backend : un webhook RevenueCat qui appelle le
`_grant_premium` / `_revoke_premium` déjà écrits dans `premium.py` — la logique
d'attribution existe et est correcte, il s'agit de lui brancher une seconde source.

Il faudra aussi retirer la mention « Test mode — no real charges » de l'écran premium, et
ajouter le bouton **« Restaurer mes achats »** qu'Apple exige explicitement.

---

## Phase 7 — La conformité (~1 jour de dev + rédaction)

### 7.1 [TOI] Politique de confidentialité et CGU

Deux pages en ligne, accessibles publiquement. GitHub Pages suffit, ou une page de ton
site. La politique doit couvrir : e-mail, photos de profil, contenu des conversations,
ville déclarée, données de paiement, et le recours à l'IA (Claude) pour analyser les
profils. Les générateurs type Termly ou iubenda font un premier jet correct.

Il faut aussi des **CGU** (EULA) : Apple les exige pour toute app à contenu généré par les
utilisateurs, avec une clause de tolérance zéro envers les contenus abusifs.

### 7.2 [MOI] Les liens et le contrôle d'âge dans l'app

Liens vers ces deux pages à l'inscription, dans les réglages et sur l'écran premium
(obligatoire à côté d'un abonnement). Plus une vérification d'âge minimum à l'onboarding :
le champ `age` n'a aujourd'hui aucune borne, ni côté app ni côté API.

### 7.3 [TOI] Le questionnaire de confidentialité Apple

Dans App Store Connect, section **App Privacy**. Déclare : adresse e-mail, photos,
contenu utilisateur, identifiants, données d'usage. Il doit être **cohérent avec ta
politique de confidentialité** — les incohérences sont relevées à la revue.

Classification d'âge : réseau social avec contenu généré par les utilisateurs et
messagerie → **17+** en pratique.

### 7.4 Ce qui est déjà en règle

Suppression de compte (règle 5.1.1(v)), blocage et signalement (règle 1.2) : tout est déjà
implémenté et fonctionnel. Il te restera à indiquer une **adresse e-mail de contact
modération** et à t'engager sur un traitement des signalements sous 24 h, ce que la revue
Apple vérifie parfois en envoyant un signalement de test.

---

## Phase 8 — Ce qui n'est pas bloquant mais fait la différence

### 8.1 [MOI] Notifications push (~1 jour)

`expo-notifications` n'est installé nulle part. Pour une app de matching c'est le
principal levier de rétention, et c'est aussi ce qui rend les appels entrants utilisables
quand l'app est fermée. À noter : l'écran de réglages affiche déjà un interrupteur
« Notifications » qui ne pilote rien.

### 8.2 [TOI] Un relais TURN pour les appels vidéo

Sans lui, 10 à 20 % des appels établissent la signalisation puis échouent à faire passer
la vidéo (NAT symétrique, réseaux mobiles, pare-feux d'entreprise). Metered.ca propose une
offre gratuite suffisante pour démarrer ; Twilio et Cloudflare sont les alternatives.
Trois valeurs à renseigner sur Render : `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`.

### 8.3 [MOI] Photos en stockage objet

Les photos sont stockées en base64 dans les documents MongoDB. Ça fonctionne, mais chaque
carte de swipe transporte les images entières et le cluster se remplit vite. Migration
vers Cloudflare R2 — la même approche que sur BioBoost.

### 8.4 [MOI] Nettoyages

Remplacer les images Unsplash utilisées comme photos de remplacement dans huit écrans
(question de licence, et ce sont des portraits de personnes réelles présentés comme de
faux profils). Retirer les dépendances mortes (`zustand`, les deux paquets Gluestack,
`@gorhom/bottom-sheet`, `react-native-webview`, `react-native-dotenv`).

---

## Phase 9 — Builds et soumission

### 9.1 Build interne, pour tester sur un vrai téléphone

```sh
cd frontend
npx eas build --profile preview --platform ios
npx eas build --profile preview --platform android
```

⚠️ Les appels vidéo utilisent `react-native-webrtc`, un module natif : **Expo Go ne peut
pas les exécuter**. Il faut un build de développement ou de preview pour les tester.

### 9.2 [TOI] Les captures d'écran

Apple exige des captures pour iPhone 6,9 pouces et 6,5 pouces (et iPad si tu gardes
`supportsTablet: true` — voir 4.3). Google demande au minimum deux captures téléphone plus
une bannière 1024×500.

### 9.3 Build de production et envoi

```sh
npx eas build --profile production --platform all
npx eas submit --platform ios
npx eas submit --platform android
```

### 9.4 [TOI] Compte à rebours de la revue

Apple : 24 à 48 h en général. Un premier rejet est **normal** — prévois deux allers-retours.
Google : quelques heures, mais avec l'obligation de test fermé de la phase 0.2 si ton
compte est personnel.

---

## Calendrier réaliste

| | Durée | Dépend de |
|---|---|---|
| Phases 1 à 3 (backend en ligne) | une demi-journée | rien |
| Phase 4 (identité visuelle) | 1 jour | création graphique |
| Phase 5 (connexion) | 1 jour | validation du compte Apple |
| Phase 6 (achats intégrés) | 3 jours | contrat Paid Applications signé |
| Phase 7 (conformité) | 1 jour | rédaction des pages légales |
| Phase 8 (le reste) | 2 jours | rien |
| Revue des stores | 2 à 5 jours | Apple, Google |

Soit **deux à trois semaines** jusqu'à une première soumission crédible, en supposant que
la validation du compte Apple démarre aujourd'hui. Le chemin critique passe par le compte
Apple, puis le contrat Paid Applications, puis les achats intégrés.

---

## Le strict minimum pour être publiable

Si tu veux la liste réduite à ce qui provoque un rejet certain :

1. Achats intégrés à la place de Stripe sur mobile (phase 6)
2. Sign in with Apple (phase 5.2)
3. Icône 1024×1024 sans transparence (phase 4.1)
4. Politique de confidentialité et CGU en ligne, liées dans l'app (phase 7)
5. Un backend accessible depuis internet (phases 1 et 2)

Tout le reste améliore le produit ou réduit le risque, mais ne bloque pas la publication.
