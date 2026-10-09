/* =========================================================
   Application Budget : enveloppes + cagnotte des repas
   Tout est stocké dans le téléphone (IndexedDB).
   Aucune donnée n'est envoyée sur internet.
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. Constantes
   --------------------------------------------------------- */

// Version du format des données. À augmenter seulement si on change
// la forme des données (pour pouvoir relire les anciennes sauvegardes).
const VERSION_SCHEMA = 3; // v2 : devises étrangères ; v3 : budget total, réserve et revenus

const BASE_NOM = 'budget-app';
const BASE_VERSION = 1;

// Couleurs proposées pour les enveloppes (lisibles en clair et en sombre)
const PALETTE = ['#1F8A70', '#2F5FA7', '#C58B17', '#7B52A8', '#D0623F', '#5E8A2A', '#56677C', '#B3446F'];
// Anciennes couleurs (versions 1 à 4) → nouvelles teintes équivalentes
const ANCIENNES_COULEURS = { '#2A9D8F': '#1F8A70', '#3D6FB6': '#2F5FA7', '#D19A1F': '#C58B17', '#7A5BB5': '#7B52A8', '#E07A5F': '#D0623F', '#5C9A3B': '#5E8A2A', '#5E6B7A': '#56677C', '#C4508C': '#B3446F' };
function moderniserCouleurs(liste) {
  let change = false;
  (liste || []).forEach((e) => { if (ANCIENNES_COULEURS[e.couleur]) { e.couleur = ANCIENNES_COULEURS[e.couleur]; change = true; } });
  return change;
}

// Rappel de sauvegarde au-delà de ce nombre de jours
const JOURS_RAPPEL_SAUVEGARDE = 30;

// Types de dépenses dans l'enveloppe des repas
const GENRES_REPAS = {
  repas: 'Repas acheté',
  maison: 'Fait maison',
  offert: 'Offert ou sauté',
  courses: 'Courses'
};

/* ---------------------------------------------------------
   2. Petits outils
   --------------------------------------------------------- */

const $ = (sel, parent = document) => parent.querySelector(sel);
const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));

// Les montants sont stockés en centimes (nombres entiers) pour éviter
// les erreurs d'arrondi : 6,59 € est stocké 659.
const formatEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euros = (centimes) => formatEuro.format((centimes || 0) / 100);
const eurosSigne = (c) => (c > 0 ? '+' : '') + euros(c);

// Transforme un texte tapé ("6,59", "12", "3.5") en centimes. Renvoie NaN si invalide.
function lireNombre(texte) {
  if (texte == null) return NaN;
  const t = String(texte).replace(/[\s\u00A0\u202F€]/g, '').replace(',', '.');
  if (t === '' || !/^\d*\.?\d*$/.test(t) || t === '.') return NaN;
  return parseFloat(t);
}
function lireMontant(texte) {
  const n = lireNombre(texte);
  return isNaN(n) ? NaN : Math.round(n * 100);
}
// Centimes → texte modifiable ("6,59")
const montantEnTexte = (c) => (c / 100).toFixed(2).replace('.', ',');

// Protège les textes saisis avant de les afficher
function esc(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const deux = (n) => String(n).padStart(2, '0');
const dateIso = (d) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
const aujourdhui = () => dateIso(new Date());
const cleMois = (d = new Date()) => dateIso(d).slice(0, 7); // "2026-10"

function decalerMois(cle, n) {
  const [a, m] = cle.split('-').map(Number);
  return cleMois(new Date(a, m - 1 + n, 1));
}
function joursDuMois(cle) {
  const [a, m] = cle.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
function nomMois(cle, court = false) {
  const [a, m] = cle.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('fr-FR', court ? { month: 'short' } : { month: 'long', year: 'numeric' });
}
function nomJour(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(a, m - 1, j);
  if (iso === aujourdhui()) return "Aujourd'hui";
  const hier = new Date(); hier.setDate(hier.getDate() - 1);
  if (iso === dateIso(hier)) return 'Hier';
  const t = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function nouvelId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
const copie = (obj) => JSON.parse(JSON.stringify(obj));

/* ---------------------------------------------------------
   3. Stockage dans le téléphone (IndexedDB)
   IndexedDB = une petite base de données intégrée au navigateur.
   --------------------------------------------------------- */

let base = null;

function ouvrirBase() {
  return new Promise((ok, echec) => {
    if (!('indexedDB' in window)) return echec(new Error('stockage-absent'));
    let demande;
    try { demande = indexedDB.open(BASE_NOM, BASE_VERSION); } catch (e) { return echec(e); }
    demande.onupgradeneeded = () => {
      const b = demande.result;
      if (!b.objectStoreNames.contains('reglages')) b.createObjectStore('reglages', { keyPath: 'cle' });
      if (!b.objectStoreNames.contains('depenses')) b.createObjectStore('depenses', { keyPath: 'id' });
      if (!b.objectStoreNames.contains('mois')) b.createObjectStore('mois', { keyPath: 'mois' });
      if (!b.objectStoreNames.contains('bilans')) b.createObjectStore('bilans', { keyPath: 'mois' });
    };
    demande.onsuccess = () => ok(demande.result);
    demande.onerror = () => echec(demande.error);
    demande.onblocked = () => echec(new Error('base-bloquee'));
  });
}

// Lance une opération d'écriture/lecture et attend qu'elle soit terminée
function transaction(magasins, mode, travail) {
  return new Promise((ok, echec) => {
    let t;
    try { t = base.transaction(magasins, mode); } catch (e) { return echec(e); }
    let resultat;
    t.oncomplete = () => ok(resultat);
    t.onerror = () => echec(t.error);
    t.onabort = () => echec(t.error || new Error('transaction-annulee'));
    try { resultat = travail(t); } catch (e) { t.abort(); echec(e); }
  });
}

function lireTout(magasin) {
  return new Promise((ok, echec) => {
    const r = base.transaction(magasin, 'readonly').objectStore(magasin).getAll();
    r.onsuccess = () => ok(r.result || []);
    r.onerror = () => echec(r.error);
  });
}

// Message clair si l'enregistrement échoue
function erreurStockage(e) {
  console.error(e);
  const nom = e && e.name;
  if (nom === 'QuotaExceededError') {
    alerteMessage('Stockage plein', "Le téléphone n'a plus assez de place pour enregistrer. Libère de l'espace (photos, applis), puis fais une sauvegarde depuis Réglages.");
  } else {
    alerteMessage("Enregistrement impossible", "La dernière modification n'a pas pu être enregistrée dans le téléphone. Ferme puis rouvre l'appli. Si le problème continue, fais une sauvegarde depuis Réglages.");
  }
}

// Raccourcis d'enregistrement : ne bloquent jamais l'interface
function sauver(magasin, objet) {
  return transaction([magasin], 'readwrite', (t) => t.objectStore(magasin).put(objet)).catch(erreurStockage);
}
function effacer(magasin, cle) {
  return transaction([magasin], 'readwrite', (t) => t.objectStore(magasin).delete(cle)).catch(erreurStockage);
}

/* ---------------------------------------------------------
   3 bis. Devises et taux de change
   Les taux viennent d'ExchangeRate-API (gratuit, sans compte).
   L'appli demande seulement la liste publique des taux :
   rien sur toi ni sur tes dépenses n'est envoyé.
   --------------------------------------------------------- */

const URL_TAUX = 'https://open.er-api.com/v6/latest/EUR';
const DELAI_MAJ_TAUX = 6 * 3600 * 1000; // on ne redemande pas plus d'une fois toutes les 6 h

const cacheFormats = {};
let nomsDevises = null;

// Nombre de chiffres après la virgule pour une devise (2 pour l'euro, 0 pour le yen...)
function decimalesDevise(code) {
  try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits; }
  catch (e) { return 2; }
}
function formatteur(code) {
  if (!cacheFormats[code]) {
    try { cacheFormats[code] = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }); }
    catch (e) {
      try { cacheFormats[code] = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }); }
      catch (e2) { cacheFormats[code] = { format: (v) => `${v.toFixed(2).replace('.', ',')} ${code}`, formatToParts: null }; }
    }
  }
  return cacheFormats[code];
}
// Montant dans sa devise ; les nombres ronds s'affichent sans « ,00 » (ex. « 520 Rs »)
function formatDevise(valeur, code) {
  const texte = formatteur(code).format(valeur);
  return Number.isInteger(valeur) ? texte.replace(/,0+(?=\D*$)/, '') : texte;
}
function symboleDevise(code) {
  const f = formatteur(code);
  if (!f.formatToParts) return code;
  const part = f.formatToParts(1).find((p) => p.type === 'currency');
  return part ? part.value : code;
}
function nomDevise(code) {
  try {
    if (!nomsDevises) nomsDevises = new Intl.DisplayNames(['fr'], { type: 'currency' });
    return majuscule(nomsDevises.of(code) || code);
  } catch (e) { return code; }
}
// Affiche un taux lisiblement (ex. « 50,35 Rs »)
const afficherTaux = (taux, code) => `${taux.toLocaleString('fr-FR', { maximumSignificantDigits: 5 })} ${symboleDevise(code)}`;

// Nombre d'unités de la devise pour 1 € (null si inconnu)
function tauxPour(code) {
  if (code === 'EUR') return 1;
  const t = etat.taux && etat.taux.taux && etat.taux.taux[code];
  return t > 0 ? t : null;
}
// Convertit un montant d'une devise en centimes d'euro, frais compris
function versEuros(valeur, code, taux, fraisPct = 0) {
  if (code === 'EUR') return Math.round(valeur * 100);
  return Math.round((valeur / taux) * 100 * (1 + (fraisPct || 0) / 100));
}
// Nombre → texte modifiable (« 350 », « 12,50 »)
function nombreEnTexte(v, code) {
  if (code !== 'EUR' && Number.isInteger(v)) return String(v);
  return v.toFixed(code === 'EUR' ? 2 : decimalesDevise(code)).replace('.', ',');
}

const sansAccents = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Liste des devises trouvées pour une recherche ; onChoix(code) quand on en touche une
function afficherResultatsDevises(zone, recherche, onChoix) {
  if (!etat.taux) {
    zone.innerHTML = '<div class="vide">Connecte-toi à internet pour charger la liste des devises.</div>';
    return;
  }
  const q = sansAccents(recherche.trim());
  let liste = ['EUR', ...Object.keys(etat.taux.taux).filter((c) => c !== 'EUR')].map((c) => ({ c, n: nomDevise(c) }));
  if (q) liste = liste.filter((x) => sansAccents(x.c).includes(q) || sansAccents(x.n).includes(q));
  liste.sort((a, b) => a.n.localeCompare(b.n, 'fr'));
  if (!liste.length) { zone.innerHTML = '<div class="vide">Aucune devise trouvée.</div>'; return; }
  zone.innerHTML = liste.slice(0, 40).map((x) => `<button data-code="${x.c}"><span>${esc(x.n)}</span><span class="chiffre">${x.c}</span></button>`).join('');
  $$('[data-code]', zone).forEach((b) => b.addEventListener('click', () => onChoix(b.dataset.code)));
}

const dateCourte = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const dateLongue = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// Télécharge les taux du jour (en silence, sauf si demandé depuis Réglages)
let majTauxEnCours = false;
async function majTaux(force = false) {
  if (majTauxEnCours || !base) return;
  const t = etat.taux;
  if (!force && t && Date.now() - Date.parse(t.recupereLe) < DELAI_MAJ_TAUX) return;
  if (!force && navigator.onLine === false) return;
  majTauxEnCours = true;
  const controle = window.AbortController ? new AbortController() : null;
  const minuteur = setTimeout(() => controle && controle.abort(), 10000);
  try {
    const r = await fetch(URL_TAUX, { cache: 'no-store', signal: controle ? controle.signal : undefined });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.result !== 'success' || !j.rates || !j.rates.MUR) throw new Error('réponse inattendue');
    etat.taux = {
      cle: 'taux',
      base: 'EUR',
      taux: j.rates,
      majLe: new Date((j.time_last_update_unix || Date.now() / 1000) * 1000).toISOString(),
      recupereLe: new Date().toISOString()
    };
    await sauver('reglages', etat.taux);
    if (force) toast('Taux mis à jour.');
    if (vueActive === 'reglages' && $('#panneau').hidden) rendreReglages();
  } catch (e) {
    console.warn('Taux non récupérés', e);
    if (force) toast('Impossible de récupérer les taux. Vérifie ta connexion.');
  } finally {
    clearTimeout(minuteur);
    majTauxEnCours = false;
  }
}

/* ---------------------------------------------------------
   4. Données de l'application (en mémoire + copie dans IndexedDB)
   --------------------------------------------------------- */

const etat = {
  reglages: null, // enveloppes, conservation, date de dernière sauvegarde...
  mois: {},       // un enregistrement par mois : enveloppes du mois + charges fixes payées
  depenses: [],   // toutes les dépenses détaillées
  bilans: [],     // résumés des vieux mois (une ligne par mois)
  taux: null      // derniers taux de change téléchargés (non exportés)
};
let persistanceAccordee = null;

function reglagesParDefaut() {
  const r = {
    cle: 'principal',
    creeLe: new Date().toISOString(),
    derniereSauvegarde: null,
    conservationMois: 12,
    devises: { favoris: ['EUR', 'MUR'], derniere: 'EUR', fraisPct: 0 },
    enveloppes: [
      { id: nouvelId(), nom: 'Nourriture', type: 'repas', couleur: '#1F8A70', prixRepas: 659, repasParJour: 2, jours: 31 },
      { id: nouvelId(), nom: 'Loisirs', type: 'variable', couleur: '#7B52A8', montant: 30 * 659, cagnotte: true },
      { id: nouvelId(), nom: 'Essence', type: 'variable', couleur: '#C58B17', montant: 0, cagnotte: false },
      { id: nouvelId(), nom: 'Loyer', type: 'fixe', couleur: '#56677C', montant: 0 },
      { id: nouvelId(), nom: 'Location voiture', type: 'fixe', couleur: '#2F5FA7', montant: 0 }
    ]
  };
  r.budgetTotal = sommeEnveloppes(r.enveloppes);
  return r;
}

// Mise à niveau des anciennes données (v1 → v2 : devises ; v2 → v3 : budget total)
function completerReglages(r) {
  let change = false;
  if (!r.devises) {
    r.devises = { favoris: ['EUR', 'MUR'], derniere: 'EUR', fraisPct: 0 };
    change = true;
  }
  if (typeof r.budgetTotal !== 'number') {
    r.budgetTotal = sommeEnveloppes(r.enveloppes); // au départ : rien ne change, réserve à 0
    change = true;
  }
  return change;
}
function completerDepense(d) {
  if (d.devise) return false;
  d.devise = 'EUR';
  d.montantOrigine = d.montant / 100;
  d.taux = 1;
  d.frais = 0;
  return true;
}

async function chargerEtat() {
  const [reglages, mois, depenses, bilans] = await Promise.all(['reglages', 'mois', 'depenses', 'bilans'].map(lireTout));
  etat.reglages = reglages.find((r) => r.cle === 'principal') || null;
  etat.taux = reglages.find((r) => r.cle === 'taux') || null;
  if (!etat.reglages) {
    etat.reglages = reglagesParDefaut();
    await sauver('reglages', etat.reglages);
  }
  if (completerReglages(etat.reglages)) await sauver('reglages', etat.reglages);
  const aCompleter = depenses.filter(completerDepense);
  if (aCompleter.length) {
    await transaction(['depenses'], 'readwrite', (t) => aCompleter.forEach((d) => t.objectStore('depenses').put(d))).catch(erreurStockage);
  }
  if (moderniserCouleurs(etat.reglages.enveloppes)) await sauver('reglages', etat.reglages);
  etat.mois = {};
  mois.forEach((m) => {
    if (moderniserCouleurs(m.enveloppes)) sauver('mois', m);
    etat.mois[m.mois] = m;
  });
  etat.depenses = depenses;
  etat.bilans = bilans.sort((a, b) => a.mois.localeCompare(b.mois));
}

// Crée la fiche d'un mois (copie des enveloppes actuelles) si elle n'existe pas
function assurerMois(cle) {
  if (!etat.mois[cle]) {
    etat.mois[cle] = { mois: cle, enveloppes: copie(etat.reglages.enveloppes), fixesPayes: {}, budgetTotal: etat.reglages.budgetTotal };
    sauver('mois', etat.mois[cle]);
  }
  return etat.mois[cle];
}

// Les réglages s'appliquent au mois en cours ; les mois passés gardent leur version
function appliquerEnveloppes(liste) {
  etat.reglages.enveloppes = liste;
  sauver('reglages', etat.reglages);
  const m = assurerMois(cleMois());
  m.enveloppes = copie(liste);
  m.budgetTotal = etat.reglages.budgetTotal;
  sauver('mois', m);
}

const depensesDuMois = (cle) => etat.depenses.filter((d) => d.mois === cle);
const enveloppeRepas = (liste) => liste.find((e) => e.type === 'repas');

/* ---------------------------------------------------------
   5. Calculs du mois (le cœur du système d'enveloppes)
   --------------------------------------------------------- */

const montantEnveloppe = (e) => (e.type === 'repas' ? e.prixRepas * e.repasParJour * e.jours : (e.montant || 0));
const compteCommeRepas = (d) => !d.revenu && (d.genre === 'repas' || d.genre === 'maison' || d.genre === 'offert');
const sommeEnveloppes = (liste) => liste.reduce((s, e) => s + montantEnveloppe(e), 0);

// La réserve libre : la part du budget qui n'est dans aucune enveloppe, plus les revenus
const ID_RESERVE = 'reserve';
const ENV_RESERVE = { id: ID_RESERVE, nom: 'Réserve', type: 'reserve', couleur: '#A88A45' };

/*
  Règles :
  - budget du mois = budget total choisi + revenus du mois
  - réserve = budget total − somme des enveloppes + revenus ; elle se dépense comme une enveloppe
  - cagnotte des repas = repas pris × prix d'un repas − dépenses de nourriture
  - si une enveloppe autorisée (ex. Loisirs) dépasse, le dépassement est pris sur la cagnotte
  - si la cagnotte devient négative, ça réduit le budget des repas restants
*/
function calculerMois(cle, depenses = depensesDuMois(cle)) {
  const fiche = etat.mois[cle] || { enveloppes: etat.reglages.enveloppes, fixesPayes: {}, budgetTotal: etat.reglages.budgetTotal };
  const sommeEnv = sommeEnveloppes(fiche.enveloppes);
  // Les mois d'avant cette version n'ont pas de budget total : on prend la somme des enveloppes
  const budgetMois = typeof fiche.budgetTotal === 'number' ? fiche.budgetTotal : sommeEnv;

  const parEnv = {};
  fiche.enveloppes.forEach((e) => { parEnv[e.id] = { env: e, budget: montantEnveloppe(e), depense: 0 }; });
  const reserve = { env: ENV_RESERVE, budget: 0, depense: 0 };
  parEnv[ID_RESERVE] = reserve;

  let revenus = 0;
  let horsEnveloppe = 0; // dépenses d'une enveloppe supprimée depuis
  depenses.forEach((d) => {
    if (d.revenu) { revenus += d.montant; return; }
    if (parEnv[d.envId]) parEnv[d.envId].depense += d.montant;
    else horsEnveloppe += d.montant;
  });

  reserve.budget = budgetMois - sommeEnv + revenus;
  reserve.consomme = reserve.depense;
  reserve.reste = reserve.budget - reserve.depense;

  let totalConsomme = horsEnveloppe + reserve.consomme;
  let surCagnotte = 0;

  fiche.enveloppes.forEach((e) => {
    const p = parEnv[e.id];
    if (e.type === 'fixe') {
      p.paye = !!fiche.fixesPayes[e.id];
      p.consomme = (p.paye ? p.budget : 0) + p.depense;
      p.reste = p.budget - p.consomme;
    } else if (e.type === 'variable') {
      p.consomme = p.depense;
      p.reste = p.budget - p.depense;
      p.depassement = Math.max(0, -p.reste);
      p.prisSurCagnotte = e.cagnotte ? p.depassement : 0;
      surCagnotte += p.prisSurCagnotte;
    } else {
      p.consomme = p.depense;
    }
    totalConsomme += p.consomme;
  });

  const eRepas = enveloppeRepas(fiche.enveloppes);
  let repas = null;
  if (eRepas) {
    const p = parEnv[eRepas.id];
    const deps = depenses.filter((d) => d.envId === eRepas.id);
    p.repasPris = deps.filter(compteCommeRepas).length;
    p.repasTotal = eRepas.repasParJour * eRepas.jours;
    p.repasRestants = p.repasTotal - p.repasPris;
    p.cagnotte = p.repasPris * eRepas.prixRepas - p.depense - surCagnotte;
    p.reste = p.budget - p.depense - surCagnotte;
    p.parRepas = p.repasRestants > 0 ? Math.floor(p.reste / p.repasRestants) : null;
    repas = p;
  }

  const totalBudget = budgetMois + revenus;
  return { parEnv, repas, reserve, revenus, budgetMois, sommeEnv, totalBudget, totalConsomme, resteGlobal: totalBudget - totalConsomme };
}

/* ---------------------------------------------------------
   6. Navigation, panneau, confirmation, messages
   --------------------------------------------------------- */

let vueActive = 'budget';

function changerVue(nom) {
  vueActive = nom;
  $$('.onglet').forEach((b) => b.classList.toggle('actif', b.dataset.vue === nom));
  $$('.vue').forEach((v) => { v.hidden = v.id !== 'vue-' + nom; });
  window.scrollTo(0, 0);
  rendreVue();
  majBarreHaut();
}

function ouvrirPanneau(html) {
  const p = $('#panneau');
  const dejaOuvert = !p.hidden;
  const defilement = p.scrollTop;
  p.innerHTML = '<div class="poignee"></div>' + html;
  p.hidden = false;
  $('#voile').hidden = false;
  document.body.style.overflow = 'hidden';
  p.scrollTop = dejaOuvert ? defilement : 0; // garde la position quand on redessine
  const fermer = $('.fermer', p);
  if (fermer) fermer.addEventListener('click', fermerPanneau);
  return p;
}
function fermerPanneau() {
  $('#panneau').hidden = true;
  $('#panneau').innerHTML = '';
  $('#voile').hidden = true;
  document.body.style.overflow = '';
}
const enteteePanneau = (titre) => `
  <div class="panneau-titre"><h2>${esc(titre)}</h2>
  <button class="fermer" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;

// Fenêtre de confirmation. Renvoie une promesse : true si l'utilisateur confirme.
function confirmer({ titre, texte = '', oui = 'Confirmer', non = 'Annuler', danger = false }) {
  return new Promise((reponse) => {
    const fond = $('#confirm');
    $('#confirm-titre').textContent = titre;
    $('#confirm-texte').textContent = texte;
    const bOui = $('#confirm-oui');
    const bNon = $('#confirm-non');
    bOui.textContent = oui;
    bNon.textContent = non;
    bNon.hidden = non === null;
    bOui.classList.toggle('danger', danger);
    fond.hidden = false;
    const fin = (valeur) => {
      fond.hidden = true;
      bOui.onclick = null; bNon.onclick = null;
      reponse(valeur);
    };
    bOui.onclick = () => fin(true);
    bNon.onclick = () => fin(false);
  });
}
const alerteMessage = (titre, texte) => confirmer({ titre, texte, oui: 'OK', non: null });

let minuteurToast = null;
function toast(texte) {
  const t = $('#toast');
  t.textContent = texte;
  t.hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------------------------------------------------------
   7. Bandeau du haut : reste global (toujours visible)
   --------------------------------------------------------- */

function rendreGlobal() {
  const c = calculerMois(cleMois());
  const m = $('#barre-montant');
  m.textContent = euros(c.resteGlobal);
  m.classList.toggle('negatif', c.resteGlobal < 0);
  majBarreHaut();
}

const TITRES_VUES = { budget: 'Budget', historique: 'Historique', stats: 'Statistiques', reglages: 'Réglages' };

// Sur l'onglet Budget, la barre n'apparaît que quand la carte héros sort de l'écran
function majBarreHaut() {
  const barre = $('#barre-haut');
  const hauteur = barre.offsetHeight;
  document.body.dataset.vue = vueActive;
  $('#barre-titre').textContent = TITRES_VUES[vueActive] || 'Budget';
  // Le petit titre n'apparaît que lorsque le grand titre est sorti de l'écran (comme sur iOS)
  const grand = $(`#vue-${vueActive} .grand-titre`);
  barre.classList.toggle('titre-visible', !!grand && grand.getBoundingClientRect().bottom < hauteur);
  // Onglet Budget : la barre se montre quand le montant de la carte héros n'est plus visible
  let discret = false;
  if (vueActive === 'budget') {
    const montant = $('.heros-montant');
    discret = !!montant && montant.getBoundingClientRect().bottom > hauteur;
  }
  barre.classList.toggle('discret', discret);
}

/* ---------------------------------------------------------
   8. Onglet Budget
   --------------------------------------------------------- */

function bandeauxInformation() {
  let html = '';
  const r = etat.reglages;

  // Montants pas encore renseignés
  const aZero = r.enveloppes.filter((e) => e.type !== 'repas' && !e.montant).map((e) => e.nom);
  if (aZero.length) {
    html += `<div class="bandeau"><p>Indique le montant de : ${esc(aZero.join(', '))}.</p>
      <div class="bandeau-boutons"><button class="btn btn-petit btn-principal" data-action="aller-reglages">Ouvrir les réglages</button></div></div>`;
  }

  // Vieux mois à résumer
  const aArchiver = moisAArchiver();
  if (aArchiver.length) {
    const noms = aArchiver.map((c) => nomMois(c)).join(', ');
    html += `<div class="bandeau"><p>Le détail de ${esc(noms)} a plus de ${r.conservationMois} mois. Il va être résumé en une ligne pour garder l'appli légère. Sauvegarde avant si tu veux garder le détail.</p>
      <div class="bandeau-boutons">
        <button class="btn btn-petit btn-discret" data-action="exporter">Sauvegarder</button>
        <button class="btn btn-petit btn-principal" data-action="archiver">Résumer</button>
      </div></div>`;
  }

  // Rappel de sauvegarde
  const reference = new Date(r.derniereSauvegarde || r.creeLe);
  const jours = Math.floor((Date.now() - reference.getTime()) / 86400000);
  if (jours > JOURS_RAPPEL_SAUVEGARDE) {
    const texte = r.derniereSauvegarde ? `Dernière sauvegarde il y a ${jours} jours.` : "Tu n'as encore jamais sauvegardé tes données.";
    html += `<div class="bandeau"><p>${texte}</p>
      <div class="bandeau-boutons"><button class="btn btn-petit btn-principal" data-action="exporter">Sauvegarder maintenant</button></div></div>`;
  }
  return html;
}

// Anneau de progression : part restante de l'enveloppe
function anneau(fraction, couleur, negatif = false) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return `<svg class="anneau ${negatif ? 'negatif' : ''}" viewBox="0 0 40 40" style="--c:${couleur}" aria-hidden="true">
    <circle class="piste" cx="20" cy="20" r="${r}" fill="none" stroke-width="5"/>
    ${negatif ? '' : `<circle class="arc" cx="20" cy="20" r="${r}" fill="none" stroke-width="5" stroke-dasharray="${(f * circ).toFixed(2)} ${circ.toFixed(2)}"/>`}
  </svg>`;
}

// Une ligne d'enveloppe : anneau, nom, reste ; détails seulement s'ils sont utiles
function rangeeEnveloppe(p) {
  const e = p.env;
  let reste = p.reste;
  let gauche = `sur ${euros(p.budget)}`;
  let droite = '';
  if (e.type === 'repas') {
    gauche = p.parRepas !== null ? `${euros(p.parRepas)} par repas` : `${p.repasPris} repas pris`;
    if (p.reste < 0) droite = `<span class="rouge">Dépassé</span>`;
    else droite = p.cagnotte >= 0
      ? `<span class="positif">${eurosSigne(p.cagnotte)} économisés</span>`
      : `<span class="attention">${euros(-p.cagnotte)} à amortir</span>`;
  } else if (p.prisSurCagnotte > 0) {
    reste = 0;
    droite = `<span class="attention">${euros(p.prisSurCagnotte)} sur les économies</span>`;
  } else if (p.reste < 0) {
    droite = `<span class="rouge">Dépassé</span>`;
  } else if (e.type === 'reserve') {
    gauche = 'Budget non réparti et revenus';
  }
  const fraction = p.budget > 0 ? reste / p.budget : 0;
  return `
    <button class="rangee" data-env="${e.id}">
      ${anneau(fraction, e.couleur, reste < 0)}
      <span class="env-texte"><span class="env-nom">${esc(e.nom)}</span><span class="env-sous">${gauche}</span></span>
      <span class="env-droite"><span class="env-reste ${reste < 0 ? 'negatif' : ''}">${euros(reste)}</span>${droite ? `<span class="env-sous">${droite}</span>` : ''}</span>
    </button>`;
}

// Carte héros : reste du mois, jauge des dépenses courantes et repère du jour
function carteHeros(c, fiche, cle) {
  const fixes = fiche.enveloppes.filter((e) => e.type === 'fixe');
  const budgetFixes = fixes.reduce((s, e) => s + c.parEnv[e.id].budget, 0);
  const fixesPayes = fixes.reduce((s, e) => s + (c.parEnv[e.id].paye ? c.parEnv[e.id].budget : 0), 0);
  const fixesAPayer = budgetFixes - fixesPayes;
  const budgetCourant = c.totalBudget - budgetFixes;
  const depenseCourante = c.totalConsomme - fixesPayes;
  const ratioDepense = budgetCourant > 0 ? Math.max(0, Math.min(1, depenseCourante / budgetCourant)) : 1;

  const nbJours = joursDuMois(cle);
  const jour = new Date().getDate();
  const ratioTemps = (jour - 0.5) / nbJours;
  const joursRestants = nbJours - jour + 1;
  const rapide = ratioDepense > ratioTemps + 0.03;

  const disponible = c.resteGlobal - fixesAPayer;
  let conseil;
  if (c.resteGlobal < 0) {
    conseil = `<span class="alerte-heros">Budget dépassé de ${euros(-c.resteGlobal)}.</span>`;
  } else if (disponible <= 0) {
    conseil = `<span class="alerte-heros">Tout ce qui reste est réservé à tes charges fixes.</span>`;
  } else {
    conseil = `Environ <strong>${euros(Math.floor(disponible / joursRestants))}</strong> par jour jusqu'à la fin du mois`;
    conseil += fixesAPayer > 0 ? ', charges fixes déjà mises de côté.' : '.';
    if (rapide) conseil += ` <span class="alerte-heros">Tu dépenses plus vite que le mois n'avance.</span>`;
  }

  const posJour = (ratioTemps * 100).toFixed(1);
  const bord = ratioTemps < 0.12 ? 'bord-gauche' : ratioTemps > 0.88 ? 'bord-droit' : '';
  return `
    <section class="heros" aria-label="Reste du mois">
      <p class="heros-etiquette">Reste ce mois-ci</p>
      <p class="heros-montant ${c.resteGlobal < 0 ? 'negatif' : ''}">${euros(c.resteGlobal)}</p>
      <div class="jauge-zone">
        <span class="jauge-jour-etiquette ${bord}" style="left:${posJour}%">Aujourd'hui</span>
        <div class="jauge ${rapide ? 'rapide' : ''}" role="img" aria-label="${euros(depenseCourante)} dépensés sur ${euros(budgetCourant)}, jour ${jour} sur ${nbJours}">
          <div class="jauge-remplie" style="width:${(ratioDepense * 100).toFixed(1)}%"></div>
          <div class="jauge-jour" style="left:${posJour}%"></div>
        </div>
      </div>
      <div class="heros-legende"><span>${euros(depenseCourante)} dépensés</span><span>sur ${euros(budgetCourant)}</span></div>
      <p class="heros-conseil">${conseil}</p>
    </section>`;
}

function rendreBudget() {
  const cle = cleMois();
  const fiche = assurerMois(cle);
  const c = calculerMois(cle);
  const vue = $('#vue-budget');

  let html = `<h1 class="grand-titre">${majuscule(nomMois(cle).split(' ')[0])}</h1>`;
  html += carteHeros(c, fiche, cle);
  html += bandeauxInformation();

  html += '<h2>Enveloppes</h2><div class="liste">';
  fiche.enveloppes.filter((e) => e.type !== 'fixe').forEach((e) => { html += rangeeEnveloppe(c.parEnv[e.id]); });
  if (c.reserve.budget !== 0 || c.reserve.depense > 0) html += rangeeEnveloppe(c.reserve);
  html += '</div>';

  const fixes = fiche.enveloppes.filter((e) => e.type === 'fixe');
  if (fixes.length) {
    html += '<h2>Charges fixes</h2><div class="fixes">';
    fixes.forEach((e) => {
      const paye = !!fiche.fixesPayes[e.id];
      html += `<button class="fixe ${paye ? 'paye' : ''}" style="--c:${e.couleur}" data-fixe="${e.id}" role="checkbox" aria-checked="${paye}">
        <span class="coche"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <span class="fixe-nom">${esc(e.nom)}</span>
        <span class="fixe-montant">${euros(e.montant)}</span>
      </button>`;
    });
    html += '</div><p class="aide">Coche une charge une fois payée.</p>';
  }
  vue.innerHTML = html;

  $$('[data-env]', vue).forEach((b) => b.addEventListener('click', () => ouvrirSaisie({ envId: b.dataset.env })));
  $$('[data-fixe]', vue).forEach((b) => b.addEventListener('click', () => basculerFixe(b.dataset.fixe)));
  brancherActionsCommunes(vue);
  majBarreHaut();
}

function basculerFixe(id) {
  const fiche = assurerMois(cleMois());
  if (fiche.fixesPayes[id]) delete fiche.fixesPayes[id];
  else fiche.fixesPayes[id] = true;
  sauver('mois', fiche);
  rendreTout();
}

// Boutons présents dans plusieurs écrans (bandeaux)
function brancherActionsCommunes(zone) {
  $$('[data-action="aller-reglages"]', zone).forEach((b) => b.addEventListener('click', () => changerVue('reglages')));
  $$('[data-action="exporter"]', zone).forEach((b) => b.addEventListener('click', exporter));
  $$('[data-action="archiver"]', zone).forEach((b) => b.addEventListener('click', archiver));
}

/* ---------------------------------------------------------
   9. Saisie et modification d'une dépense ou d'un revenu
   --------------------------------------------------------- */

function momentParDefaut() {
  return new Date().getHours() < 16 ? 'midi' : 'soir';
}

// options : { depense } pour modifier, ou { envId, genre, revenu } pour une nouvelle saisie
function ouvrirSaisie(options = {}) {
  const existante = options.depense || null;
  const mois = existante ? existante.mois : cleMois();
  const fiche = assurerMois(mois);
  // Enveloppes où l'on peut dépenser : les variables, la nourriture et la réserve
  const envsSaisie = [...fiche.enveloppes.filter((e) => e.type !== 'fixe'), ENV_RESERVE];
  const eRepas = enveloppeRepas(fiche.enveloppes);
  const regDev = etat.reglages.devises;
  const sansMontant = (genre) => genre === 'maison' || genre === 'offert';

  // Valeurs du formulaire
  const f = existante ? {
    sens: existante.revenu ? 'revenu' : 'depense',
    envId: existante.revenu ? ID_RESERVE : existante.envId,
    genre: existante.genre,
    moment: existante.moment || momentParDefaut(),
    devise: existante.devise || 'EUR',
    taux: existante.taux || 1,
    frais: existante.frais || 0,
    montantTxt: sansMontant(existante.genre) ? '' : nombreEnTexte(existante.montantOrigine ?? existante.montant / 100, existante.devise || 'EUR'),
    auto: false,
    note: existante.note || '',
    date: existante.date,
    options: false,
    recherche: false
  } : {
    sens: options.revenu ? 'revenu' : 'depense',
    envId: options.envId || (eRepas ? eRepas.id : envsSaisie[0].id),
    genre: options.genre || 'repas',
    moment: momentParDefaut(),
    devise: regDev.derniere || 'EUR',
    taux: null,
    frais: 0,
    montantTxt: '',
    auto: false,
    note: '',
    date: mois === cleMois() ? aujourdhui() : `${mois}-01`,
    options: false,
    recherche: false
  };
  const estRevenu = () => f.sens === 'revenu';
  const estRepasEnv = () => !estRevenu() && eRepas && f.envId === eRepas.id;
  const avecMontant = () => !(estRepasEnv() && sansMontant(f.genre));
  const avecMoment = () => estRepasEnv() && f.genre !== 'courses';

  // Montant du repas pré-rempli dans la devise choisie (équivalent de 6,59 €, arrondi)
  function preremplir() {
    if (f.devise === 'EUR') f.montantTxt = montantEnTexte(eRepas.prixRepas);
    else if (f.taux) f.montantTxt = String(Math.round((eRepas.prixRepas / 100) * f.taux));
    else f.montantTxt = '';
    f.auto = true;
  }

  // Changement de devise : on reprend le taux figé si c'est la devise d'origine
  function changerDevise(code) {
    f.devise = code;
    f.recherche = false;
    if (existante && (existante.devise || 'EUR') === code) {
      f.taux = existante.taux || 1;
      f.frais = existante.frais || 0;
    } else {
      f.taux = tauxPour(code);
      f.frais = code === 'EUR' ? 0 : (regDev.fraisPct || 0);
    }
    if (f.auto && f.genre === 'repas' && estRepasEnv()) preremplir();
  }

  if (!existante) {
    if (f.devise !== 'EUR' && !tauxPour(f.devise)) f.devise = 'EUR';
    changerDevise(f.devise);
    if (!estRepasEnv()) f.genre = 'libre';
    if (f.genre === 'repas') preremplir();
  }

  const derniersJour = `${mois}-${deux(joursDuMois(mois))}`;

  function dessiner() {
    const titre = existante
      ? (estRevenu() ? 'Modifier le revenu' : 'Modifier la dépense')
      : (estRevenu() ? 'Nouveau revenu' : 'Nouvelle dépense');
    const sens = existante ? '' : `
      <div class="champ"><div class="segment">
        <button data-sens="depense" aria-pressed="${!estRevenu()}">Dépense</button>
        <button data-sens="revenu" aria-pressed="${estRevenu()}">Revenu</button>
      </div></div>`;

    // Montant et devise
    let montant;
    if (avecMontant()) {
      const codes = [...new Set([...regDev.favoris, f.devise])];
      const chips = codes.map((c) => `<button data-devise="${c}" aria-pressed="${c === f.devise}">${esc(symboleDevise(c))} <small>${c}</small></button>`).join('')
        + `<button data-devise-autre aria-pressed="${f.recherche}">Autre</button>`;
      const recherche = f.recherche ? `
        <div class="recherche-devise">
          <input id="recherche-devise" type="text" autocomplete="off" placeholder="Rechercher : dollar, yen, MUR...">
          <div class="resultats" id="resultats-devise"></div>
        </div>` : '';
      montant = `
        <div class="champ">
          <div class="montant-ligne">
            <input id="saisie-montant" class="montant-saisie" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Montant" value="${esc(f.montantTxt)}">
            <span class="montant-devise">${esc(f.devise)}</span>
          </div>
          <div class="conversion" id="conversion"></div>
          <div class="choix choix-petit">${chips}</div>
          ${recherche}
        </div>`;
    } else {
      montant = `<p class="aide">Compte pour ${euros(eRepas.prixRepas)} dans tes économies, sans dépense.</p>`;
    }

    const envChoix = estRevenu() ? '' : `
      <div class="champ"><div class="choix">
        ${envsSaisie.map((e) => `<button style="--c:${e.couleur}" data-choix-env="${e.id}" aria-pressed="${e.id === f.envId}"><span class="pastille"></span>${esc(e.nom)}</button>`).join('')}
      </div></div>`;
    const genreChoix = estRepasEnv() ? `
      <div class="champ"><div class="choix choix-petit">
        ${Object.entries(GENRES_REPAS).map(([g, nom]) => `<button data-choix-genre="${g}" aria-pressed="${g === f.genre}">${nom}</button>`).join('')}
      </div></div>` : '';

    // Options repliées : moment du repas, note, date
    const optionsContenu = f.options ? `
      ${avecMoment() ? `<div class="champ"><div class="segment">
        <button data-moment="midi" aria-pressed="${f.moment === 'midi'}">Midi</button>
        <button data-moment="soir" aria-pressed="${f.moment === 'soir'}">Soir</button>
      </div></div>` : ''}
      <div class="champ"><label for="saisie-note">Note</label>
        <input id="saisie-note" type="text" autocomplete="off" placeholder="${estRevenu() ? 'Ex. : babysitting' : 'Ex. : resto U, cinéma'}" value="${esc(f.note)}"></div>
      <div class="champ"><label for="saisie-date">Date</label>
        <input id="saisie-date" type="date" min="${mois}-01" max="${derniersJour}" value="${f.date}"></div>` : '';

    const p = ouvrirPanneau(`
      ${enteteePanneau(titre)}
      ${sens}
      ${montant}
      ${envChoix}
      ${genreChoix}
      <div class="apercu" id="apercu"></div>
      <button class="btn btn-principal btn-large" id="saisie-ok">${existante ? 'Enregistrer' : 'Ajouter'}</button>
      <button class="plus-options" id="plus-options" aria-expanded="${f.options}">${f.options ? 'Masquer les options' : (avecMoment() ? 'Midi ou soir, note, date' : 'Note, date')}</button>
      ${optionsContenu}
      ${existante ? '<button class="btn btn-danger btn-large" id="saisie-suppr">Supprimer</button>' : ''}
    `);

    $$('[data-sens]', p).forEach((b) => b.addEventListener('click', () => {
      if (f.sens === b.dataset.sens) return;
      f.sens = b.dataset.sens;
      if (estRevenu()) {
        f.envId = ID_RESERVE;
        if (f.auto) { f.montantTxt = ''; f.auto = false; }
      } else {
        f.envId = eRepas ? eRepas.id : envsSaisie[0].id;
        f.genre = estRepasEnv() ? 'repas' : 'libre';
        if (estRepasEnv() && !f.montantTxt) preremplir();
      }
      dessiner();
    }));
    $$('[data-choix-env]', p).forEach((b) => b.addEventListener('click', () => {
      f.envId = b.dataset.choixEnv;
      if (estRepasEnv()) {
        f.genre = 'repas';
        if (!f.montantTxt) preremplir();
      } else {
        f.genre = 'libre';
        if (f.auto) { f.montantTxt = ''; f.auto = false; }
      }
      dessiner();
    }));
    $$('[data-choix-genre]', p).forEach((b) => b.addEventListener('click', () => {
      f.genre = b.dataset.choixGenre;
      if (f.genre === 'repas' && !f.montantTxt) preremplir();
      if (f.genre === 'courses' && f.auto) { f.montantTxt = ''; f.auto = false; }
      dessiner();
      if (f.genre === 'courses' && !f.montantTxt) $('#saisie-montant')?.focus();
    }));
    $$('[data-moment]', p).forEach((b) => b.addEventListener('click', () => { f.moment = b.dataset.moment; dessiner(); }));
    $$('[data-devise]', p).forEach((b) => b.addEventListener('click', () => {
      changerDevise(b.dataset.devise);
      if (!f.taux && f.devise !== 'EUR') majTaux(); // tente de récupérer le taux s'il manque
      dessiner();
    }));
    $('[data-devise-autre]', p)?.addEventListener('click', () => {
      f.recherche = !f.recherche;
      dessiner();
      $('#recherche-devise')?.focus();
    });
    const champRecherche = $('#recherche-devise', p);
    if (champRecherche) {
      const zone = $('#resultats-devise', p);
      const choisir = (code) => { changerDevise(code); dessiner(); };
      champRecherche.addEventListener('input', () => afficherResultatsDevises(zone, champRecherche.value, choisir));
      afficherResultatsDevises(zone, '', choisir);
    }
    $('#plus-options', p).addEventListener('click', () => { f.options = !f.options; dessiner(); });

    const champMontant = $('#saisie-montant', p);
    if (champMontant) champMontant.addEventListener('input', () => { f.montantTxt = champMontant.value; f.auto = false; majApercu(); });
    $('#saisie-note', p)?.addEventListener('input', (ev) => { f.note = ev.target.value; });
    $('#saisie-date', p)?.addEventListener('change', (ev) => { f.date = ev.target.value; majApercu(); });
    $('#saisie-ok', p).addEventListener('click', valider);
    if (existante) $('#saisie-suppr', p).addEventListener('click', supprimerDepense);
    majApercu();
  }

  const tauxManquant = () => avecMontant() && f.devise !== 'EUR' && !f.taux;

  // Construit l'enregistrement à partir du formulaire (ou null si invalide)
  function construire() {
    let montant = 0;
    let devise = 'EUR';
    let montantOrigine = 0;
    let taux = 1;
    let frais = 0;
    if (avecMontant()) {
      const v = lireNombre(f.montantTxt);
      if (!(v > 0)) return null;
      devise = f.devise;
      if (devise === 'EUR') {
        montant = Math.round(v * 100);
        montantOrigine = montant / 100;
      } else {
        if (!f.taux) return null;
        taux = f.taux;
        frais = estRevenu() ? 0 : (f.frais || 0); // pas de frais ajoutés sur un revenu
        const dec = decimalesDevise(devise);
        montantOrigine = Math.round(v * 10 ** dec) / 10 ** dec;
        montant = Math.max(1, versEuros(montantOrigine, devise, taux, frais));
      }
    }
    const date = f.date && f.date.startsWith(mois) ? f.date : (mois === cleMois() ? aujourdhui() : `${mois}-01`);
    const enreg = {
      id: existante ? existante.id : nouvelId(),
      envId: estRevenu() ? ID_RESERVE : f.envId,
      genre: estRevenu() ? 'revenu' : (estRepasEnv() ? f.genre : 'libre'),
      moment: avecMoment() ? f.moment : null,
      montant,          // en centimes d'euro : c'est ce montant qui compte dans le budget
      devise,           // devise de saisie (EUR, MUR...)
      montantOrigine,   // montant tapé, dans sa devise
      taux,             // nombre d'unités de la devise pour 1 €, figé à la saisie
      frais,            // frais de change en %, figés à la saisie
      note: f.note.trim(),
      date,
      mois,
      creeLe: existante ? existante.creeLe : new Date().toISOString()
    };
    if (estRevenu()) enreg.revenu = true; // un revenu augmente le budget (va dans la réserve)
    return enreg;
  }

  // Calcule l'effet de la saisie et prépare le message d'aperçu
  function analyser(dep) {
    const autres = depensesDuMois(mois).filter((d) => !existante || d.id !== existante.id);
    const avant = calculerMois(mois, autres);
    const apres = calculerMois(mois, dep ? [...autres, dep] : autres);

    if (estRevenu()) {
      return { niveau: 'ok', texte: `Ta réserve passera à <strong>${euros(apres.reserve.reste)}</strong>, ton budget du mois à <strong>${euros(apres.totalBudget)}</strong>.` };
    }

    const pA = apres.parEnv[f.envId];
    const e = pA.env;
    let texte = '';
    let niveau = 'ok';

    if (e.type === 'repas') {
      const r = apres.repas;
      texte = r.repasRestants > 0
        ? `Il restera <strong>${euros(r.reste)}</strong>, soit <strong>${euros(r.parRepas)}</strong> par repas.`
        : `Il restera <strong>${euros(r.reste)}</strong>.`;
      if (r.reste < 0 && r.reste < avant.repas.reste) {
        niveau = 'alerte';
        texte = `Ça dépasse le budget nourriture de <strong>${euros(-r.reste)}</strong>.`;
      }
    } else if (e.cagnotte && pA.prisSurCagnotte > 0) {
      const r = apres.repas;
      niveau = 'attention';
      texte = `Enveloppe vide : <strong>${euros(pA.prisSurCagnotte)}</strong> seront pris sur tes économies de repas.`;
      if (r && r.cagnotte < 0) texte += ` Ton budget par repas passera à <strong>${euros(r.parRepas || 0)}</strong>.`;
      if (!r) { niveau = 'alerte'; texte = `Ça dépasse ${esc(e.nom)} de <strong>${euros(pA.depassement)}</strong>.`; }
    } else if (pA.reste < 0) {
      niveau = 'alerte';
      texte = `Ça dépasse ${esc(e.nom)} de <strong>${euros(-pA.reste)}</strong>.`;
    } else {
      texte = `Il restera <strong>${euros(pA.reste)}</strong> dans ${esc(e.nom)}.`;
    }
    if (apres.resteGlobal < 0 && apres.resteGlobal < avant.resteGlobal) {
      niveau = 'alerte';
      texte += ` Ton budget du mois passera à <strong>${euros(apres.resteGlobal)}</strong>.`;
    }
    // Pas d'alerte si la situation ne s'aggrave pas (ex. on baisse un montant)
    if (niveau !== 'ok' && apres.resteGlobal >= avant.resteGlobal && pA.consomme <= avant.parEnv[f.envId].consomme) niveau = 'ok';
    return { texte, niveau };
  }

  // Ligne sous le montant : équivalent en euros et taux utilisé
  function majConversion() {
    const zone = $('#conversion');
    if (!zone) return;
    if (f.devise === 'EUR') { zone.textContent = ''; return; }
    if (!f.taux) {
      zone.innerHTML = `<span class="rouge">Taux inconnu pour ${esc(nomDevise(f.devise))}. Connecte-toi une fois à internet.</span>`;
      return;
    }
    const v = lireNombre(f.montantTxt);
    const frais = estRevenu() ? 0 : f.frais;
    const fige = existante && (existante.devise || 'EUR') === f.devise;
    let t = v > 0 ? `≈ ${euros(Math.max(1, versEuros(v, f.devise, f.taux, frais)))}` : `1 € = ${afficherTaux(f.taux, f.devise)}`;
    t += fige ? ' (taux du jour de saisie)' : (etat.taux ? ` (taux du ${dateCourte(etat.taux.majLe)})` : '');
    if (frais) t += `, frais ${String(frais).replace('.', ',')} % compris`;
    zone.textContent = t;
  }

  function majApercu() {
    majConversion();
    const zone = $('#apercu');
    if (!zone) return;
    const dep = construire();
    if (!dep) {
      zone.className = 'apercu';
      if (tauxManquant()) zone.innerHTML = 'Choisis une autre devise ou connecte-toi pour récupérer le taux.';
      else zone.innerHTML = f.montantTxt ? 'Montant invalide. Exemple : 6,59' : 'Indique le montant.';
      return;
    }
    const { texte, niveau } = analyser(dep);
    zone.className = 'apercu' + (niveau === 'alerte' ? ' alerte' : niveau === 'attention' ? ' attention' : '');
    zone.innerHTML = texte;
  }

  async function valider() {
    const dep = construire();
    if (!dep) {
      if (tauxManquant()) { toast('Taux de change inconnu pour cette devise.'); return; }
      $('#saisie-montant')?.focus();
      toast('Indique un montant valide.');
      return;
    }
    const { niveau, texte } = analyser(dep);
    if (niveau !== 'ok') {
      const tmp = document.createElement('div');
      tmp.innerHTML = texte;
      const ok = await confirmer({ titre: 'Attention au budget', texte: tmp.textContent, oui: 'Ajouter quand même' });
      if (!ok) return;
    }
    if (existante) {
      const i = etat.depenses.findIndex((d) => d.id === dep.id);
      if (i >= 0) etat.depenses[i] = dep;
    } else {
      etat.depenses.push(dep);
    }
    sauver('depenses', dep);
    // On retient la dernière devise utilisée pour la prochaine saisie
    if (avecMontant() && regDev.derniere !== dep.devise) {
      regDev.derniere = dep.devise;
      sauver('reglages', etat.reglages);
    }
    fermerPanneau();
    rendreTout();
    toast(estRevenu() ? (existante ? 'Revenu modifié.' : 'Revenu ajouté.') : (existante ? 'Dépense modifiée.' : 'Dépense ajoutée.'));
  }

  async function supprimerDepense() {
    const quoi = estRevenu() ? 'ce revenu' : 'cette dépense';
    const ok = await confirmer({ titre: `Supprimer ${quoi} ?`, texte: 'Cette action est définitive.', oui: 'Supprimer', danger: true });
    if (!ok) return;
    etat.depenses = etat.depenses.filter((d) => d.id !== existante.id);
    effacer('depenses', existante.id);
    fermerPanneau();
    rendreTout();
    toast('Supprimé.');
  }

  dessiner();
}

/* ---------------------------------------------------------
   10. Onglet Historique
   --------------------------------------------------------- */

let moisHistorique = null;

function titreDepense(d, env) {
  if (d.revenu) return d.note || 'Revenu';
  if (env && env.type === 'repas') {
    const genre = GENRES_REPAS[d.genre] || 'Dépense';
    if (d.genre === 'courses') return d.note ? `Courses, ${d.note}` : 'Courses';
    const moment = d.moment === 'midi' ? 'Midi' : d.moment === 'soir' ? 'Soir' : '';
    return [moment, genre.toLowerCase()].filter(Boolean).join(', ') + (d.note ? ` (${d.note})` : '');
  }
  return d.note || (env ? env.nom : 'Dépense');
}

function rendreHistorique() {
  const vue = $('#vue-historique');
  const moisDispo = Object.keys(etat.mois).sort().reverse();
  if (!moisHistorique || !etat.mois[moisHistorique]) moisHistorique = cleMois();
  const cle = moisHistorique;
  const fiche = etat.mois[cle];
  const c = calculerMois(cle);
  const deps = depensesDuMois(cle).sort((a, b) => (b.date + b.creeLe).localeCompare(a.date + a.creeLe));

  let html = '<h1 class="grand-titre">Historique</h1>';
  if (moisDispo.length > 1) {
    html += `<div class="champ"><select id="choix-mois" aria-label="Mois">
      ${moisDispo.map((m) => `<option value="${m}" ${m === cle ? 'selected' : ''}>${majuscule(nomMois(m))}</option>`).join('')}
    </select></div>`;
  } else {
    html += `<p class="aide">${majuscule(nomMois(cle))}</p>`;
  }
  html += `<div class="resume">
    <div class="tuile"><div class="tuile-etiquette">Dépensé</div><div class="tuile-valeur">${euros(c.totalConsomme)}</div></div>
    <div class="tuile"><div class="tuile-etiquette">Reste</div><div class="tuile-valeur ${c.resteGlobal < 0 ? 'negatif' : ''}">${euros(c.resteGlobal)}</div></div>
  </div>`;
  if (c.revenus > 0) html += `<p class="aide">Dont ${euros(c.revenus)} de revenus ajoutés ce mois-ci.</p>`;

  if (!deps.length) {
    html += `<div class="vide">Rien ce mois-ci. Appuie sur + pour commencer.</div>`;
  } else {
    let jourCourant = null;
    deps.forEach((d) => {
      if (d.date !== jourCourant) {
        if (jourCourant) html += '</div>';
        jourCourant = d.date;
        html += `<div class="jour">${esc(nomJour(d.date))}</div><div class="liste">`;
      }
      const env = d.envId === ID_RESERVE ? ENV_RESERVE : fiche.enveloppes.find((e) => e.id === d.envId);
      const gratuit = compteCommeRepas(d) && d.montant === 0;
      const origine = d.devise && d.devise !== 'EUR' ? `<span class="ligne-orig">${esc(formatDevise(d.montantOrigine, d.devise))}</span>` : '';
      const valeur = d.revenu ? `+${euros(d.montant)}` : (gratuit ? '0 €' : euros(d.montant));
      html += `<button class="ligne" data-dep="${d.id}">
        <span class="pastille" style="--c:${d.revenu ? 'var(--vert)' : (env ? env.couleur : '#999')}"></span>
        <span class="ligne-texte"><span class="ligne-titre">${esc(titreDepense(d, env))}</span>
        ${(() => {
          const titre = titreDepense(d, env);
          const sous = d.revenu ? 'Ajouté à la réserve' : (env ? (env.nom === titre ? '' : env.nom) : 'Enveloppe supprimée');
          return sous ? `<span class="ligne-sous">${esc(sous)}</span>` : '';
        })()}</span>
        <span class="ligne-valeur ${gratuit || d.revenu ? 'zero' : ''}"><span>${valeur}</span>${origine}</span>
      </button>`;
    });
    html += '</div>';
  }

  if (etat.bilans.length) {
    html += '<h3>Mois archivés</h3><div class="liste">';
    [...etat.bilans].reverse().forEach((b) => {
      html += `<div class="ligne"><span class="ligne-texte"><span class="ligne-titre">${majuscule(nomMois(b.mois))}</span>
        <span class="ligne-sous">Dépensé ${euros(b.depense)} sur ${euros(b.budget)}</span></span>
        <span class="ligne-valeur ${b.economies >= 0 ? 'zero' : ''}"><span>${eurosSigne(b.economies)}</span><span class="ligne-orig">économies repas</span></span></div>`;
    });
    html += '</div>';
  }

  vue.innerHTML = html;
  $('#choix-mois', vue)?.addEventListener('change', (ev) => { moisHistorique = ev.target.value; rendreHistorique(); });
  $$('[data-dep]', vue).forEach((b) => b.addEventListener('click', () => {
    const d = etat.depenses.find((x) => x.id === b.dataset.dep);
    if (d) ouvrirSaisie({ depense: d });
  }));
}

/* ---------------------------------------------------------
   11. Onglet Statistiques (graphiques dessinés en SVG, sans bibliothèque)
   --------------------------------------------------------- */

function graphiqueAnneau(parts) {
  const total = parts.reduce((s, p) => s + p.valeur, 0);
  if (total <= 0) return '<div class="vide">Pas encore de dépense ce mois-ci.</div>';
  let cumul = 0;
  const arcs = parts.map((p) => {
    const pct = (p.valeur / total) * 100;
    const arc = `<circle r="15.915" cx="21" cy="21" fill="none" stroke="${p.couleur}" stroke-width="6"
      stroke-dasharray="${pct.toFixed(3)} ${(100 - pct).toFixed(3)}" stroke-dashoffset="${(25 - cumul).toFixed(3)}"/>`;
    cumul += pct;
    return arc;
  }).join('');
  const legende = parts.map((p) => `<div><span class="pastille" style="--c:${p.couleur}"></span>${esc(p.nom)}
    <span class="chiffre">${euros(p.valeur)}</span></div>`).join('');
  return `<svg viewBox="0 0 42 42" style="max-width:200px;margin:0 auto" role="img" aria-label="Répartition des dépenses">${arcs}
    <text x="21" y="22.6" text-anchor="middle" font-size="4.4" font-weight="800" style="fill:var(--encre)">${euros(total)}</text></svg>
    <div class="legende">${legende}</div>`;
}

function graphiqueBarres(valeurs, etiquettes, { couleur = 'var(--vert)', couleurNeg = 'var(--ambre)', hauteur = 140, etiquetteTous = 1 } = {}) {
  const largeur = 320;
  const n = valeurs.length;
  const max = Math.max(1, ...valeurs.map((v) => Math.abs(v)));
  const aNegatif = valeurs.some((v) => v < 0);
  const zone = hauteur - 22;
  const zero = aNegatif ? zone / 2 : zone;
  const echelle = aNegatif ? zone / 2 / max : zone / max;
  const pas = largeur / n;
  const l = Math.max(2, pas * 0.68);
  let barres = '';
  valeurs.forEach((v, i) => {
    const h = Math.abs(v) * echelle;
    const x = i * pas + (pas - l) / 2;
    const y = v >= 0 ? zero - h : zero;
    if (v !== 0) barres += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${l.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="${Math.min(3, l / 2).toFixed(1)}" fill="${v >= 0 ? couleur : couleurNeg}"/>`;
    if (i % etiquetteTous === 0 || i === n - 1) barres += `<text x="${(i * pas + pas / 2).toFixed(1)}" y="${hauteur - 4}" text-anchor="middle" font-size="10">${esc(etiquettes[i])}</text>`;
  });
  const axe = `<line x1="0" x2="${largeur}" y1="${zero}" y2="${zero}" stroke="var(--trait)" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" role="img">${axe}${barres}</svg>`;
}

function rendreStats() {
  const vue = $('#vue-stats');
  const cle = cleMois();
  const fiche = assurerMois(cle);
  const c = calculerMois(cle);
  let html = `<h1 class="grand-titre">Statistiques</h1><p class="aide">${majuscule(nomMois(cle))}</p>`;

  // 1. Où part l'argent
  const parts = [...fiche.enveloppes, ENV_RESERVE]
    .map((e) => ({ nom: e.nom, couleur: e.couleur, valeur: c.parEnv[e.id].consomme }))
    .filter((p) => p.valeur > 0)
    .sort((a, b) => b.valeur - a.valeur);
  html += `<h2>Où part ton argent</h2><div class="graphique">${graphiqueAnneau(parts)}</div>`;

  // 2. Économies mois après mois
  const serie = [];
  etat.bilans.forEach((b) => serie.push({ mois: b.mois, valeur: b.economies }));
  Object.keys(etat.mois).sort().forEach((m) => {
    const r = calculerMois(m).repas;
    serie.push({ mois: m, valeur: r ? r.cagnotte : 0 });
  });
  const derniers = serie.slice(-12);
  html += '<h2>Économies sur les repas</h2><div class="graphique">';
  html += derniers.length > 1
    ? graphiqueBarres(derniers.map((s) => s.valeur / 100), derniers.map((s) => nomMois(s.mois, true).replace('.', '')))
    : `<div class="vide">Ce graphique apparaîtra le mois prochain. Ce mois-ci : ${c.repas ? eurosSigne(c.repas.cagnotte) : '0 €'}.</div>`;
  html += '</div>';
  vue.innerHTML = html;
}

/* ---------------------------------------------------------
   12. Onglet Réglages
   --------------------------------------------------------- */

let rechercheFavori = false;

function sousTexteEnveloppe(e) {
  if (e.type === 'repas') return `Prix d'un repas, soit ${euros(montantEnveloppe(e))} par mois`;
  if (e.type === 'fixe') return 'Charge fixe';
  return e.cagnotte ? 'Peut utiliser les économies' : 'Variable';
}

// Texte sous le budget total : comment il se répartit
function texteRepartition(budget) {
  const somme = sommeEnveloppes(etat.reglages.enveloppes);
  if (!(budget >= 0)) return '<span class="rouge">Montant invalide.</span>';
  const reserve = budget - somme;
  if (reserve < 0) return `<span class="rouge">Tes enveloppes (${euros(somme)}) dépassent ce budget de ${euros(-reserve)}.</span> <button class="lien" id="ajuster-budget">Mettre le budget à ${euros(somme)}</button>`;
  return `Enveloppes : ${euros(somme)}. Réserve libre : ${euros(reserve)}.`;
}

function rendreReglages() {
  const vue = $('#vue-reglages');
  const r = etat.reglages;
  const dev = r.devises;

  // Budget total
  let html = `<h1 class="grand-titre">Réglages</h1>
    <h2>Budget du mois</h2>
    <div class="budget-carte">
      <div class="montant-ligne">
        <input id="budget-total" class="montant-saisie" inputmode="decimal" autocomplete="off" aria-label="Budget du mois" value="${montantEnTexte(r.budgetTotal)}">
        <span class="montant-devise">EUR</span>
      </div>
      <p class="aide" id="repartition">${texteRepartition(r.budgetTotal)}</p>
    </div>`;

  // Enveloppes : montant modifiable directement, crayon pour le reste
  const crayon = '<svg class="crayon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>';
  html += `<h2>Enveloppes</h2>
    <p class="aide">Touche un montant pour le changer. Touche un nom pour le renommer, changer sa couleur ou le supprimer.</p>
    <div class="liste">`;
  r.enveloppes.forEach((e) => {
    const valeur = e.type === 'repas' ? montantEnTexte(e.prixRepas) : montantEnTexte(e.montant || 0);
    html += `<div class="ligne ligne-env">
      <button class="bouton-nom" data-editer="${e.id}" aria-label="Modifier ${esc(e.nom)}">
        <span class="pastille" style="--c:${e.couleur}"></span>
        <span class="ligne-texte"><span class="ligne-titre">${esc(e.nom)}${crayon}</span>
        <span class="ligne-sous" id="sous-${e.id}">${esc(sousTexteEnveloppe(e))}</span></span>
      </button>
      <label class="montant-inline">
        <input data-montant-env="${e.id}" inputmode="decimal" autocomplete="off" value="${valeur}"
          aria-label="${e.type === 'repas' ? 'Prix d\'un repas' : 'Montant de ' + esc(e.nom)}">
        <span>€</span>
      </label>
    </div>`;
  });
  html += `</div><div style="height:10px"></div>
    <button class="btn btn-discret btn-large" id="ajouter-env">Ajouter une enveloppe</button>`;

  // Devises
  html += `<h2>Devises</h2>
    <div class="champ"><span class="etiquette">Boutons rapides</span><div class="choix">
      ${dev.favoris.map((c) => c === 'EUR'
        ? `<button disabled aria-pressed="false">${esc(symboleDevise(c))} <small>EUR</small></button>`
        : `<button data-retirer-favori="${c}" aria-label="Retirer ${c}">${esc(symboleDevise(c))} <small>${c}</small> ✕</button>`).join('')}
      <button id="ajouter-favori" aria-pressed="${rechercheFavori}">Ajouter</button>
    </div>
    ${rechercheFavori ? `<div class="recherche-devise" style="margin-top:10px">
      <input id="recherche-favori" type="text" autocomplete="off" placeholder="Rechercher : dollar, yen, MUR...">
      <div class="resultats" id="resultats-favori"></div></div>` : ''}
    </div>
    <div class="champ"><label for="frais">Frais de change de ta banque (%)</label>
      <input id="frais" inputmode="decimal" autocomplete="off" value="${String(dev.fraisPct || 0).replace('.', ',')}"></div>
    <p class="aide">${etat.taux ? `Taux du ${dateLongue(etat.taux.majLe)}.` : 'Aucun taux pour l\'instant : connecte-toi à internet.'}
      <button class="lien" id="maj-taux">Mettre à jour</button><br>
      <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a></p>`;

  // Sauvegarde
  const derniere = r.derniereSauvegarde ? dateLongue(r.derniereSauvegarde) : 'jamais';
  html += `<h2>Sauvegarde</h2>
    <div class="deux-colonnes">
      <button class="btn btn-principal" data-action="exporter">Exporter</button>
      <button class="btn btn-discret" id="importer">Importer</button>
    </div>
    <p class="aide" style="margin-top:12px">Dernière sauvegarde : ${derniere}.${persistanceAccordee === false ? ' Installe l\'appli sur l\'écran d\'accueil pour protéger tes données.' : ''}</p>`;

  // Conservation et effacement
  html += `<h2>Historique</h2>
    <div class="champ"><select id="conservation" aria-label="Durée de conservation">
      ${[3, 6, 12, 24].map((n) => `<option value="${n}" ${r.conservationMois === n ? 'selected' : ''}>Garder le détail ${n} mois</option>`).join('')}
    </select></div>
    <button class="btn btn-danger btn-large" id="tout-effacer">Effacer toutes les données</button>`;

  vue.innerHTML = html;

  // Budget total : enregistré quand on quitte le champ
  const champBudget = $('#budget-total', vue);
  champBudget.addEventListener('input', () => { $('#repartition').innerHTML = texteRepartition(lireMontant(champBudget.value)); });
  champBudget.addEventListener('change', () => {
    const v = lireMontant(champBudget.value);
    if (!(v >= 0)) { toast('Montant invalide. Exemple : 1500'); champBudget.value = montantEnTexte(r.budgetTotal); return; }
    r.budgetTotal = v;
    sauver('reglages', r);
    const fiche = assurerMois(cleMois());
    fiche.budgetTotal = v;
    sauver('mois', fiche);
    rendreTout();
    toast('Budget enregistré.');
  });

  // Bouton « Mettre le budget à … » (le message est réécrit au fil des modifications)
  vue.onclick = (ev) => {
    if (!ev.target.closest('#ajuster-budget')) return;
    const somme = sommeEnveloppes(r.enveloppes);
    r.budgetTotal = somme;
    sauver('reglages', r);
    const fiche = assurerMois(cleMois());
    fiche.budgetTotal = somme;
    sauver('mois', fiche);
    rendreTout();
    toast(`Budget du mois : ${euros(somme)}.`);
  };
  $$('[data-editer]', vue).forEach((b) => b.addEventListener('click', () => editerEnveloppe(b.dataset.editer)));
  $$('[data-montant-env]', vue).forEach((champ) => {
    champ.addEventListener('focus', () => champ.select());
    champ.addEventListener('change', () => {
      const liste = copie(r.enveloppes);
      const e = liste.find((x) => x.id === champ.dataset.montantEnv);
      if (!e) return;
      const v = champ.value.trim() === '' ? 0 : lireMontant(champ.value);
      const ancien = e.type === 'repas' ? e.prixRepas : (e.montant || 0);
      if (!(v >= 0) || (e.type === 'repas' && !(v > 0))) {
        toast(e.type === 'repas' ? 'Prix invalide. Exemple : 6,59' : 'Montant invalide. Exemple : 450');
        champ.value = montantEnTexte(ancien);
        return;
      }
      if (e.type === 'repas') e.prixRepas = v; else e.montant = v;
      appliquerEnveloppes(liste);
      champ.value = montantEnTexte(v);
      $('#sous-' + e.id).textContent = sousTexteEnveloppe(e);
      $('#repartition').innerHTML = texteRepartition(r.budgetTotal);
      rendreGlobal();
      toast(`${e.nom} : ${e.type === 'repas' ? euros(v) + ' par repas' : euros(v)}.`);
    });
  });
  $('#ajouter-env', vue).addEventListener('click', () => editerEnveloppe(null));
  $('#importer', vue).addEventListener('click', () => $('#fichier-import').click());
  $('#conservation', vue).addEventListener('change', (ev) => {
    r.conservationMois = Number(ev.target.value);
    sauver('reglages', r);
    toast('Enregistré.');
  });
  $('#tout-effacer', vue).addEventListener('click', toutEffacer);
  brancherActionsCommunes(vue);

  // Devises favorites, frais, taux
  $$('[data-retirer-favori]', vue).forEach((b) => b.addEventListener('click', () => {
    dev.favoris = dev.favoris.filter((c) => c !== b.dataset.retirerFavori);
    sauver('reglages', r);
    rendreReglages();
  }));
  $('#ajouter-favori', vue).addEventListener('click', () => {
    rechercheFavori = !rechercheFavori;
    rendreReglages();
    $('#recherche-favori')?.focus();
  });
  const champFavori = $('#recherche-favori', vue);
  if (champFavori) {
    const zone = $('#resultats-favori', vue);
    const choisir = (code) => {
      if (!dev.favoris.includes(code)) dev.favoris.push(code);
      rechercheFavori = false;
      sauver('reglages', r);
      rendreReglages();
      toast(`${nomDevise(code)} ajouté.`);
    };
    champFavori.addEventListener('input', () => afficherResultatsDevises(zone, champFavori.value, choisir));
    afficherResultatsDevises(zone, '', choisir);
  }
  $('#frais', vue).addEventListener('change', (ev) => {
    const v = ev.target.value.trim() === '' ? 0 : lireNombre(ev.target.value);
    if (!(v >= 0 && v <= 20)) {
      toast('Frais invalides : entre 0 et 20 %.');
      ev.target.value = String(dev.fraisPct || 0).replace('.', ',');
      return;
    }
    dev.fraisPct = Math.round(v * 100) / 100;
    sauver('reglages', r);
    toast('Enregistré.');
  });
  $('#maj-taux', vue).addEventListener('click', () => majTaux(true));
}

function editerEnveloppe(id) {
  const liste = copie(etat.reglages.enveloppes);
  const existante = id ? liste.find((e) => e.id === id) : null;
  const utilisees = liste.map((e) => e.couleur);
  const e = existante || {
    id: nouvelId(), nom: '', type: 'variable', montant: 0, cagnotte: false,
    couleur: PALETTE.find((c) => !utilisees.includes(c)) || PALETTE[0]
  };
  let montantTxt = e.type === 'repas' ? '' : (e.montant ? montantEnTexte(e.montant) : '');
  let prixTxt = e.type === 'repas' ? montantEnTexte(e.prixRepas) : '';

  function dessiner() {
    const estRepas = e.type === 'repas';
    const typeChoix = estRepas ? '' : `
      <div class="champ"><span class="etiquette">Type</span><div class="segment">
        <button data-type="variable" aria-pressed="${e.type === 'variable'}">Variable</button>
        <button data-type="fixe" aria-pressed="${e.type === 'fixe'}">Charge fixe</button>
      </div><p class="aide" style="margin:8px 0 0">${e.type === 'fixe' ? 'Payée en une fois : tu la coches quand c\'est fait.' : 'Tu y saisis tes dépenses au fil du mois.'}</p></div>`;
    const champsRepas = estRepas ? `
      <div class="champ"><label for="env-prix">Prix d'un repas (€)</label>
        <input id="env-prix" inputmode="decimal" autocomplete="off" value="${esc(prixTxt)}"></div>
      <div class="deux-colonnes">
        <div class="champ"><label for="env-rpj">Repas par jour</label><input id="env-rpj" inputmode="numeric" value="${e.repasParJour}"></div>
        <div class="champ"><label for="env-jours">Jours par mois</label><input id="env-jours" inputmode="numeric" value="${e.jours}"></div>
      </div>
      <p class="aide" id="env-total"></p>` : `
      <div class="champ"><label for="env-montant">Montant par mois (€)</label>
        <input id="env-montant" class="montant-saisie" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(montantTxt)}"></div>`;
    const cagnotte = e.type === 'variable' ? `
      <label class="interrupteur champ"><span>Si elle est vide, peut utiliser les économies des repas</span>
        <input type="checkbox" id="env-cagnotte" ${e.cagnotte ? 'checked' : ''}></label>` : '';

    const p = ouvrirPanneau(`
      ${enteteePanneau(existante ? 'Modifier l\'enveloppe' : 'Nouvelle enveloppe')}
      <div class="champ"><label for="env-nom">Nom</label>
        <input id="env-nom" type="text" autocomplete="off" maxlength="40" placeholder="Ex. : Abonnements" value="${esc(e.nom)}"></div>
      ${typeChoix}
      ${champsRepas}
      ${cagnotte}
      <div class="champ"><span class="etiquette">Couleur</span><div class="palette">
        ${PALETTE.map((c) => `<button style="--c:${c}" data-couleur="${c}" aria-pressed="${c === e.couleur}" aria-label="Couleur ${c}"></button>`).join('')}
      </div></div>
      <button class="btn btn-principal btn-large" id="env-ok">${existante ? 'Enregistrer' : 'Ajouter l\'enveloppe'}</button>
      ${existante && !estRepas ? '<div style="height:10px"></div><button class="btn btn-danger btn-large" id="env-suppr">Supprimer l\'enveloppe</button>' : ''}
      ${estRepas ? '<p class="aide">L\'enveloppe des repas ne peut pas être supprimée : elle porte la cagnotte.</p>' : ''}
    `);

    const lireChamps = () => {
      e.nom = $('#env-nom', p).value;
      if (estRepas) {
        prixTxt = $('#env-prix', p).value;
        e.repasParJour = parseInt($('#env-rpj', p).value, 10);
        e.jours = parseInt($('#env-jours', p).value, 10);
      } else {
        montantTxt = $('#env-montant', p).value;
      }
      if ($('#env-cagnotte', p)) e.cagnotte = $('#env-cagnotte', p).checked;
    };
    const majTotal = () => {
      const z = $('#env-total', p);
      if (!z) return;
      lireChamps();
      const prix = lireMontant(prixTxt);
      z.textContent = prix > 0 && e.repasParJour > 0 && e.jours > 0
        ? `Budget nourriture : ${e.repasParJour * e.jours} repas × ${euros(prix)} = ${euros(prix * e.repasParJour * e.jours)}`
        : 'Vérifie les valeurs.';
    };
    $$('#env-prix, #env-rpj, #env-jours', p).forEach((i) => i.addEventListener('input', majTotal));
    majTotal();

    $$('[data-type]', p).forEach((b) => b.addEventListener('click', () => { lireChamps(); e.type = b.dataset.type; dessiner(); }));
    $$('[data-couleur]', p).forEach((b) => b.addEventListener('click', () => { lireChamps(); e.couleur = b.dataset.couleur; dessiner(); }));
    $('#env-ok', p).addEventListener('click', () => { lireChamps(); enregistrer(); });
    $('#env-suppr', p)?.addEventListener('click', supprimer);
  }

  function enregistrer() {
    e.nom = e.nom.trim();
    if (!e.nom) { toast('Donne un nom à l\'enveloppe.'); return; }
    if (e.type === 'repas') {
      const prix = lireMontant(prixTxt);
      if (!(prix > 0)) { toast('Prix d\'un repas invalide.'); return; }
      if (!(e.repasParJour >= 1 && e.repasParJour <= 10)) { toast('Repas par jour : entre 1 et 10.'); return; }
      if (!(e.jours >= 1 && e.jours <= 31)) { toast('Jours par mois : entre 1 et 31.'); return; }
      e.prixRepas = prix;
    } else {
      const m = montantTxt.trim() === '' ? 0 : lireMontant(montantTxt);
      if (!(m >= 0)) { toast('Montant invalide. Exemple : 450,00'); return; }
      e.montant = m;
      if (e.type === 'fixe') delete e.cagnotte;
      else if (e.cagnotte === undefined) e.cagnotte = false;
    }
    if (existante) {
      const i = liste.findIndex((x) => x.id === e.id);
      liste[i] = e;
    } else {
      liste.push(e);
    }
    // Une enveloppe devenue « variable » ne doit plus être cochée comme payée
    const fiche = assurerMois(cleMois());
    if (e.type !== 'fixe' && fiche.fixesPayes[e.id]) delete fiche.fixesPayes[e.id];
    appliquerEnveloppes(liste);
    fermerPanneau();
    rendreTout();
    toast(existante ? 'Enveloppe enregistrée.' : 'Enveloppe ajoutée.');
  }

  async function supprimer() {
    const cle = cleMois();
    const aSupprimer = depensesDuMois(cle).filter((d) => d.envId === e.id);
    const texte = aSupprimer.length
      ? `Ses ${aSupprimer.length} dépense(s) de ce mois seront aussi supprimées. Les mois passés ne changent pas.`
      : 'Les mois passés ne changent pas.';
    const ok = await confirmer({ titre: `Supprimer « ${existante.nom} » ?`, texte, oui: 'Supprimer', danger: true });
    if (!ok) return;
    etat.depenses = etat.depenses.filter((d) => !aSupprimer.includes(d));
    aSupprimer.forEach((d) => effacer('depenses', d.id));
    const fiche = assurerMois(cle);
    delete fiche.fixesPayes[e.id];
    appliquerEnveloppes(liste.filter((x) => x.id !== e.id));
    fermerPanneau();
    rendreTout();
    toast('Enveloppe supprimée.');
  }

  dessiner();
}

async function toutEffacer() {
  const ok1 = await confirmer({ titre: 'Effacer toutes les données ?', texte: 'Toutes tes dépenses, enveloppes et bilans seront supprimés de ce téléphone.', oui: 'Continuer', danger: true });
  if (!ok1) return;
  const ok2 = await confirmer({ titre: 'Dernière confirmation', texte: 'Sans sauvegarde, rien ne pourra être récupéré.', oui: 'Tout effacer', danger: true });
  if (!ok2) return;
  try {
    await remplacerDonnees({ reglages: reglagesParDefaut(), mois: [], depenses: [], bilans: [] });
    toast('Données effacées.');
  } catch (e) { erreurStockage(e); }
}

/* ---------------------------------------------------------
   13. Export / import (sauvegarde dans un fichier)
   --------------------------------------------------------- */

function construireExport() {
  return {
    application: 'budget',
    versionSchema: VERSION_SCHEMA,
    exporteLe: new Date().toISOString(),
    reglages: etat.reglages,
    mois: Object.values(etat.mois),
    depenses: etat.depenses,
    bilans: etat.bilans
  };
}

function marquerSauvegarde() {
  etat.reglages.derniereSauvegarde = new Date().toISOString();
  sauver('reglages', etat.reglages);
  rendreTout();
  toast('Sauvegarde faite.');
}

// Important : aucune attente avant le partage, sinon l'iPhone refuse
// (le partage doit suivre directement l'appui sur le bouton).
function exporter() {
  const json = JSON.stringify(construireExport(), null, 1);
  const nom = `budget-sauvegarde-${aujourdhui()}.json`;
  let fichier = null;
  try { fichier = new File([json], nom, { type: 'application/json' }); } catch (e) { fichier = null; }

  if (fichier && navigator.canShare && navigator.canShare({ files: [fichier] })) {
    navigator.share({ files: [fichier], title: 'Sauvegarde Budget' })
      .then(marquerSauvegarde)
      .catch((e) => { if (e && e.name !== 'AbortError') telecharger(json, nom); });
  } else {
    telecharger(json, nom);
  }
}

function telecharger(json, nom) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  marquerSauvegarde();
}

// Adapte une ancienne sauvegarde au format actuel
function migrer(donnees) {
  // Version 1 → 2 : ajout des devises (les anciennes dépenses étaient en euros)
  if (donnees.versionSchema === 1) {
    donnees.depenses.forEach(completerDepense);
    completerReglages(donnees.reglages);
    donnees.versionSchema = 2;
  }
  // Version 2 → 3 : budget total (égal à la somme des enveloppes au départ)
  if (donnees.versionSchema === 2) {
    completerReglages(donnees.reglages);
    donnees.versionSchema = 3;
  }
  return donnees;
}

function validerSauvegarde(d) {
  if (!d || typeof d !== 'object') return 'Ce fichier n\'est pas une sauvegarde valide.';
  if (d.application !== 'budget') return 'Ce fichier ne vient pas de l\'appli Budget.';
  if (typeof d.versionSchema !== 'number') return 'Version de sauvegarde inconnue.';
  if (d.versionSchema > VERSION_SCHEMA) return 'Cette sauvegarde vient d\'une version plus récente de l\'appli. Mets l\'appli à jour d\'abord.';
  if (!d.reglages || !Array.isArray(d.reglages.enveloppes)) return 'Sauvegarde incomplète : enveloppes manquantes.';
  if (!Array.isArray(d.depenses) || !Array.isArray(d.mois) || !Array.isArray(d.bilans)) return 'Sauvegarde incomplète.';
  return null;
}

async function remplacerDonnees(d) {
  const reglages = { ...d.reglages, cle: 'principal' };
  await transaction(['reglages', 'mois', 'depenses', 'bilans'], 'readwrite', (t) => {
    ['reglages', 'mois', 'depenses', 'bilans'].forEach((m) => t.objectStore(m).clear());
    t.objectStore('reglages').put(reglages);
    if (etat.taux) t.objectStore('reglages').put(etat.taux); // on garde les taux déjà téléchargés
    d.mois.forEach((m) => t.objectStore('mois').put(m));
    d.depenses.forEach((x) => t.objectStore('depenses').put(x));
    d.bilans.forEach((b) => t.objectStore('bilans').put(b));
  });
  await chargerEtat();
  assurerMois(cleMois());
  moisHistorique = null;
  rendreTout();
}

async function importerFichier(fichier) {
  let donnees;
  try {
    donnees = JSON.parse(await fichier.text());
  } catch (e) {
    alerteMessage('Import impossible', 'Le fichier est illisible. Choisis un fichier « budget-sauvegarde-....json ».');
    return;
  }
  const erreur = validerSauvegarde(donnees);
  if (erreur) { alerteMessage('Import impossible', erreur); return; }
  donnees = migrer(donnees);
  const date = donnees.exporteLe ? new Date(donnees.exporteLe).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'date inconnue';
  const ok = await confirmer({
    titre: 'Remplacer les données actuelles ?',
    texte: `Sauvegarde du ${date} : ${donnees.depenses.length} dépense(s).\nTout ce qui est actuellement dans l'appli sera remplacé.`,
    oui: 'Remplacer', danger: true
  });
  if (!ok) return;
  try {
    await remplacerDonnees(donnees);
    toast('Données importées.');
  } catch (e) { erreurStockage(e); }
}

/* ---------------------------------------------------------
   14. Archivage des vieux mois (pour garder l'appli légère)
   --------------------------------------------------------- */

function moisAArchiver() {
  const limite = decalerMois(cleMois(), -etat.reglages.conservationMois);
  return Object.keys(etat.mois).filter((c) => c < limite).sort();
}

async function archiver() {
  const liste = moisAArchiver();
  if (!liste.length) return;
  const bilans = liste.map((cle) => {
    const c = calculerMois(cle);
    return {
      mois: cle,
      budget: c.totalBudget,
      depense: c.totalConsomme,
      reste: c.resteGlobal,
      economies: c.repas ? c.repas.cagnotte : 0,
      repasPris: c.repas ? c.repas.repasPris : 0,
      revenus: c.revenus,
      parEnveloppe: [...etat.mois[cle].enveloppes, ENV_RESERVE].map((e) => ({ nom: e.nom, couleur: e.couleur, depense: c.parEnv[e.id].consomme }))
    };
  });
  const aEffacer = etat.depenses.filter((d) => liste.includes(d.mois));
  try {
    await transaction(['bilans', 'depenses', 'mois'], 'readwrite', (t) => {
      bilans.forEach((b) => t.objectStore('bilans').put(b));
      aEffacer.forEach((d) => t.objectStore('depenses').delete(d.id));
      liste.forEach((cle) => t.objectStore('mois').delete(cle));
    });
  } catch (e) { erreurStockage(e); return; }
  etat.bilans = [...etat.bilans.filter((b) => !liste.includes(b.mois)), ...bilans].sort((a, b) => a.mois.localeCompare(b.mois));
  etat.depenses = etat.depenses.filter((d) => !liste.includes(d.mois));
  liste.forEach((cle) => { delete etat.mois[cle]; });
  rendreTout();
  toast(liste.length > 1 ? 'Mois résumés.' : 'Mois résumé.');
}

/* ---------------------------------------------------------
   15. Affichage global et démarrage
   --------------------------------------------------------- */

function rendreVue() {
  if (vueActive === 'budget') rendreBudget();
  else if (vueActive === 'historique') rendreHistorique();
  else if (vueActive === 'stats') rendreStats();
  else if (vueActive === 'reglages') rendreReglages();
}
function rendreTout() {
  rendreGlobal();
  rendreVue();
}

async function demanderPersistance() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      persistanceAccordee = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    }
  } catch (e) { persistanceAccordee = null; }
  if (vueActive === 'reglages') rendreReglages();
}

function erreurDemarrage(e) {
  console.error(e);
  $('#vue-budget').innerHTML = `<div class="bandeau"><p><strong>Impossible d'accéder au stockage du téléphone.</strong></p>
    <p>Vérifie que Safari n'est pas en navigation privée, puis ferme et rouvre l'appli. Si le problème continue, redémarre le téléphone.</p></div>`;
}

let dernierJour = aujourdhui();

function brancherInterface() {
  $$('.onglet').forEach((b) => b.addEventListener('click', () => changerVue(b.dataset.vue)));
  $('#bouton-ajouter').addEventListener('click', () => ouvrirSaisie());
  $('#voile').addEventListener('click', fermerPanneau);
  $('#fichier-import').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (f) importerFichier(f);
  });
  // Quand on revient dans l'appli : nouveau jour ou nouveau mois → on met à jour
  window.addEventListener('online', () => majTaux());
  window.addEventListener('scroll', majBarreHaut, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    majTaux();
    if (aujourdhui() !== dernierJour) {
      dernierJour = aujourdhui();
      assurerMois(cleMois());
      rendreTout();
    }
  });
}

function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let recharge = false;
  // Une nouvelle version vient d'être installée : on recharge une fois
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitUneVersion || recharge) return;
    recharge = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((e) => console.warn('Service worker non installé', e));
}

async function demarrer() {
  brancherInterface();
  enregistrerServiceWorker();
  try {
    base = await ouvrirBase();
    await chargerEtat();
  } catch (e) {
    erreurDemarrage(e);
    return;
  }
  assurerMois(cleMois());
  rendreTout();
  demanderPersistance();
  majTaux();
}

demarrer();
