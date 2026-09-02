# Proposed category tree — for review before anything is built

Item 5 of the UI brief asks for a persistent two-level left sidebar with counts, and says the
current taxonomy is bad. It is, but not in the way the brief describes, and the difference
changes what has to be built first. **Nothing here is implemented.**

---

## 1. What is actually there, measured

| section | products | live | **no category at all** |
|---|---|---|---|
| **grocery** | 22,864 | 18,206 | **13,473 (58.9%)** |
| dcneu | 12,914 | 10,763 | 11 (0.1%) |
| alcohol | 1,558 | 1,535 | 0 |
| cosmetice | 1,256 | 861 | 112 (8.9%) |
| farmacie | 1,461 | 1,160 | 82 (5.6%) |

Every `Category` row in the database has `parentId = null`. **There is no tree anywhere** — all
five sections are flat lists, and the schema's `parentId` column has never been used.

### The bigger problem is grocery, not DCNeu

DCNeu's 180 flat entries are the visible symptom. But grocery — the section the site is actually
about — has **seven** categories and **13,473 products in none of them**. A left sidebar built
today would file 59% of the flagship catalogue under nothing. Fixing the tree without fixing
assignment produces a beautiful navigation to an empty shelf.

Current grocery categories, with live product counts:

```
Băcănie 2,674 · Băuturi 1,625 · Menaj & Igienă 1,378 · Legume & Fructe 371
Lactate & Ouă 221 · Panificație 220 · Mezeluri & Carne 131
```

"Băcănie" holding 2,674 products is not a category, it is a drawer.

### DCNeu already has a two-level tree and we threw it away

This is the useful discovery. `Offer.categoryPath` carries DCNeu's own breadcrumb for **10,458
of 12,914 offers**, and it is already hierarchical:

```
Cosmetice / Absorbante
Menaj / Cratite
```

The scraper kept only the leaf and created a flat `Category` row from it. The parent was
captured, stored, and then ignored at render time. So DCNeu's tree does not need to be invented
— it needs to be *read*. 5,368 offers even have a third level available.

No other merchant records `categoryPath` at all (0 of 36,411 offers). For grocery there is no
retailer hierarchy in the database to recover, which is why grocery is the expensive half.

### Two other defects in the same root cause

- **Product names are being stored as categories.** `Asevi Balsam Rufe 1 380ml Talco Rosa 60
  Spalari` is a top-level DCNeu category. It came from a category-discovery regex that is already
  in BACKLOG as "loose".
- **DCNeu's own top level is wrong for us.** Its "Cosmetice" branch contains `Balsam rufe`,
  `Detergent vase` and `Solutie pardoseli`. Adopting the retailer's tree verbatim would import
  its mistakes; it is a starting point, not an answer.

---

## 2. Proposed tree — grocery

Modelled on Auchan's own department structure, which is the brief's instruction and also the
tree Romanian shoppers already navigate at Auchan, Carrefour and Mega Image. Eleven top-level
departments, each with a small number of children. **Two levels only** — a third is where
taxonomies go to die, and the brief asks for two.

```
Fructe și legume
    Fructe proaspete · Legume proaspete · Verdețuri și salate
    Fructe uscate și nuci · Legume la borcan și murături

Carne și pește
    Pui și curcan · Porc · Vită și miel · Pește și fructe de mare
    Carne tocată · Preparate din carne crudă

Mezeluri
    Salam și cârnați · Șuncă și specialități · Crenvurști · Pateuri și conserve din carne

Lactate și ouă
    Lapte · Iaurt și sana · Brânzeturi · Cașcaval · Smântână · Unt și margarină · Ouă

Panificație
    Pâine · Toast și lipii · Cornuri și patiserie · Cozonac și checuri · Biscuiți uscați

Băcănie
    Făină și mălai · Paste făinoase · Orez și cereale · Ulei și oțet · Zahăr și miere
    Sare și condimente · Conserve și borcane · Sosuri și maioneze · Micul dejun și cereale

Dulciuri și snacks
    Ciocolată · Biscuiți și napolitane · Bomboane · Chipsuri și snacks sărate
    Alune și semințe · Deserturi și prăjituri

Băuturi
    Apă · Sucuri și nectaruri · Băuturi carbogazoase · Cafea · Ceai
    Băuturi energizante · Siropuri

Congelate
    Legume congelate · Carne și pește congelate · Pizza și preparate
    Înghețată · Cartofi congelați

Bebeluși
    Lapte praf și formule · Mâncare pentru bebeluși · Scutece · Îngrijire bebeluși

Curățenie și igienă
    Detergent de rufe · Balsam de rufe · Detergent de vase · Curățenie casă
    Hârtie igienică și șervețele · Igienă personală · Saci și pungi menaj
    Insecticide și odorizante
```

**11 departments, 62 subcategories.** Notes on specific choices, because these are the ones
worth arguing about:

- **Mezeluri is separated from Carne.** They are currently one category ("Mezeluri & Carne", 131
  products). Shoppers treat fresh meat and cold cuts as different aisles, and both Auchan and
  Carrefour split them.
- **"Băcănie" is broken into nine children.** It is currently the largest bucket at 2,674 and
  functions as "everything dry", which is exactly the drawer a sidebar has to replace.
- **"Curățenie și igienă" stays in grocery** rather than being pushed to a section of its own,
  because Auchan/Carrefour carry it in the food shop and our basket optimizer already prices
  detergent and toilet paper as part of a weekly shop.
- **No "Bio/Eco" branch.** It cuts across every department and belongs as a filter, not a
  category — otherwise "mere bio" has two homes and the counts stop adding up.

---

## 3. Proposed tree — DCNeu

Recovered from `categoryPath`, then corrected: the cleaning products DCNeu files under
"Cosmetice" are moved to "Curățenie", which is the change the brief asks for by name.

```
Curățenie
    Anticalcar (gel · lichid · pudră · tablete — the four flat entries the brief named)
    Detergent de rufe · Balsam de rufe · Detergent de vase
    Soluții de curățat (pardoseli · geam · baie · WC · bucătărie · universal · scos pete)
    Saci menaj și pungi · Lavete și bureți · Odorizante (cameră · WC · auto) · Insecticide

Îngrijire personală
    Îngrijire păr (șampon · balsam · vopsea · tratamente · fixativ · gel · spumă)
    Îngrijire corp (gel de duș · săpun · cremă corp · cremă mâini · deodorante)
    Îngrijire orală (pastă de dinți · periuțe · apă de gură)
    Ras și after shave · Machiaj · Îngrijire față · Protecție solară

Igienă
    Absorbante · Șervețele umede · Hârtie igienică · Prosoape de bucătărie
    Scutece și îngrijire copii · Dischete demachiante

Menaj și bucătărie
    Oale și cratițe · Tigăi · Farfurii și boluri · Pahare și căni · Tăvi
    Ustensile de bucătărie · Cutii alimente

Casă și decor
    Lumânări · Flori artificiale · Decorațiuni Crăciun · Casete cadou · Diverse decor

Diverse
    Hrană și accesorii animale · Articole sezoniere · Altele
```

**6 departments, ~40 subcategories** — against 180 flat entries today. The four `Anticalcar`
entries become one subcategory with a variant filter, exactly as the brief describes.

---

## 4. Proposed trees — the smaller sections

**Alcohol** already has 7 sensible categories and needs grouping, not rebuilding:

```
Vin (Vin roșu · Vin alb · Vin rosé · Vin dulce și desert)
Spumante (Șampanie · Prosecco și spumante)
Băuturi spirtoase (Whisky · Vodcă · Gin · Rom · Coniac și brandy · Țuică și rachiu · Lichior)
Bere (Blondă · Brună și specialități · Fără alcool)
```

**Cosmetice** has 39 flat entries, and about a third of them are **brands** (Ahava, Biotherm,
Collistar, Filorga, Kiehl's, L'Occitane, Moroccanoil, Peter Thomas Roth, Teoxane). Brands are
not categories:

```
Îngrijirea feței · Îngrijirea corpului · Îngrijirea părului · Machiaj
Îngrijire bărbați · Îngrijire copii · Protecție solară · Igienă orală
Seturi și cadouri
```
with **brand as a filter**, which also fixes "Ahava" and "Fata" currently sitting side by side
as if they were the same kind of thing.

**Farmacie** has 32 entries that are already close to a tree; they need one level above them:

```
Vitamine și suplimente · Digestie și ficat · Inimă și circulație
Imunitate și răceală · Sistem nervos și somn · Oase și articulații
Sănătatea femeii · Sănătatea bărbatului · Mamă și copil
Piele, păr și unghii · Diabet și metabolism · Ochi și ORL
```
Note: `Medicamente otc` (25 products) needs a separate decision — OTC medicines carry different
legal obligations from supplements, and I have not assumed one.

---

## 5. What this needs before it can be built, and the honest costs

The tree is the easy half. Assignment is the work.

1. **Schema.** `Category.parentId` exists and is unused. Populating it is a migration plus a
   backfill plus an `audit-db` invariant, per CLAUDE.md — no category may be its own ancestor,
   every leaf must have exactly one parent, and no product may sit on a parent when it has a
   leaf available.

2. **Assignment, and where it is uncertain.**
   - **DCNeu: solved.** Read `categoryPath`, map its two tops onto our six. 10,458 offers land
     directly; the ~2,456 without a path need the fallback below.
   - **Alcohol, cosmetice, farmacie: mostly solved.** Existing categories map onto the proposed
     parents by hand — a 78-row lookup table, written once.
   - **Grocery: genuinely hard.** 13,473 products have no category and no retailer breadcrumb.
     Assignment has to come from the product name, which is a matching problem, and CLAUDE.md is
     explicit about what that requires: a confidence score with a machine-readable reason, a
     golden set, and a measured diff over the whole catalogue before and after. A rule that files
     "Lapte pentru cafea" under Lactate is the same class of error as pricing it as coffee.
   - **My recommendation:** ship the sidebar for the four solved sections first, and treat
     grocery assignment as its own piece of work with its own golden set. A sidebar that is right
     for 40% of grocery is worse than no sidebar, because it teaches shoppers the categories are
     unreliable.

3. **Counts must be live-only.** The count beside each category has to use the same definition of
   "shown" as the listing (`isStale: false, flagged: false, availability: "in stock"`), or the
   sidebar will promise 200 products and deliver 60. Three audits already reported phantom
   failures for exactly this reason.

4. **The uncategorised have to go somewhere visible.** Not a silent drop: a "Necategorizate"
   entry with its real count, so the gap is measurable from the page instead of being invisible.

5. **The sidebar itself** — sticky, expandable, drawer under 900px — is a day's work once the
   data is right, and is not the risky part.

---

## 6. What I need from you

1. **Approve or amend the three trees** above (grocery, DCNeu, and the three small sections).
2. **Grocery first or last?** I recommend building the sidebar on the four solved sections and
   doing grocery assignment as a separate, measured piece. The brief says "grocery first"; the
   data says grocery is the one section where the tree cannot be populated without a classifier.
3. **`Medicamente otc`** — separate legal treatment, or fold into the tree?
4. **Brands in cosmetice** — confirm they become a filter rather than categories.
