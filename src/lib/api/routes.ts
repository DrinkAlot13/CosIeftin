// ── THE ROUTE REGISTRY. The routes validate with these; `gen:openapi` documents from them.
//
// One description per parameter, read by both. A hand-written OpenAPI drifts from the code the
// first time someone adds a field, and this project has paid for that shape three times
// (audit:sitemap's copied predicate, audit:rate-limit's recomputed budget, three implementations
// of head noun). `check:concepts` registers the generator so a second one cannot appear.

import type { ParamShape } from "./schema";

const includeDeliveryPlatform = {
  type: "boolean",
  describe:
    "Include prețurile din aplicațiile de livrare. Implicit false: marja măsurată este +11,5% " +
    "față de raft, deci amestecarea lor tăcută într-o comparație dă un răspuns greșit, nu unul mai complet.",
  default: false,
  example: false,
} as const;

export const PRODUCT_PARAMS: ParamShape = { includeDeliveryPlatform };

export const SEARCH_PARAMS: ParamShape = {
  q: { type: "string", describe: "Textul căutat.", required: true, maxLength: 120, example: "lapte" },
  limit: { type: "int", describe: "Câte rezultate. Peste maxim se limitează la maxim, nu se respinge.", min: 1, max: 50, default: 20 },
  section: { type: "enum", describe: "Secțiunea de catalog.", values: ["grocery", "alcohol", "dcneu", "cosmetice", "farmacie"], default: "grocery" },
};

export const LOOKUP_PARAMS: ParamShape = {
  url: { type: "string", describe: "URL-ul paginii de produs a magazinului. Cheia principală: singurul identificator pe care îl avem la 12 din 16 magazine.", maxLength: 2048 },
  merchant: { type: "string", describe: "Slug-ul magazinului, pentru căutarea după sku sau nume.", maxLength: 40 },
  sku: { type: "string", describe: "Codul de produs al magazinului. Funcționează doar unde îl stocăm — vezi /api/v1/meta.", maxLength: 80 },
  name: { type: "string", describe: "Numele produsului, pentru potrivirea de rezervă.", maxLength: 200 },
  size: { type: "string", describe: "Mărimea ambalajului, ex. „1 l” sau „500 g”.", maxLength: 40 },
  includeDeliveryPlatform,
};

export const META_PARAMS: ParamShape = {};

/** Everything `gen:openapi` needs, in the order the document should list it. */
export const ROUTES = [
  {
    path: "/api/v1/product/{slug}",
    method: "get",
    summary: "Un produs, cu prețurile din fiecare magazin.",
    description:
      "Pagina de produs, ca JSON. Un slug inexistent este 404; un produs existent fără niciun preț curent " +
      "este 200 cu `comparison.status = \"no-price\"` — există, iar asta este un alt răspuns.",
    params: PRODUCT_PARAMS,
    pathParams: [{ name: "slug", describe: "Slug-ul produsului." }],
    limit: "apiRead",
    cache: { sMaxAge: 3600, swr: 86_400 },
  },
  {
    path: "/api/v1/lookup",
    method: "get",
    summary: "Găsește un produs după URL-ul magazinului, după sku, sau după nume și mărime.",
    description:
      "Exact una dintre `url`, (`merchant`+`sku`) sau (`name`+`merchant`) este obligatorie. " +
      "`match.status` spune cum a fost găsit: exact, confident, review, none, unsupported. " +
      "O potrivire de grad `review` returnează `product: null` — clientul poate spune „posibil acesta”, noi nu afirmăm.",
    params: LOOKUP_PARAMS,
    pathParams: [],
    limit: "apiLookup",
    cache: { sMaxAge: 3600, swr: 86_400 },
  },
  {
    path: "/api/v1/search",
    method: "get",
    summary: "Caută în catalog.",
    description: "`kind = brand-miss` înseamnă că avem categoria dar nu marca cerută; `missing` le numește.",
    params: SEARCH_PARAMS,
    pathParams: [],
    limit: "apiRead",
    cache: { sMaxAge: 3600, swr: 86_400 },
  },
  {
    path: "/api/v1/basket/optimize",
    method: "post",
    summary: "Calculează unde este mai ieftin un coș.",
    description:
      "Maxim 100 de linii, identificate prin slug. Fiecare substituție vine cu motivul ei: un coș care " +
      "schimbă tăcut un produs și raportează doar totalul spune ceva fals despre ce cumperi.",
    params: {},
    pathParams: [],
    limit: "apiOptimize",
    cache: { sMaxAge: 0, swr: 0 },
  },
  {
    path: "/api/v1/meta",
    method: "get",
    summary: "Mărimea catalogului, magazinele, prospețimea și comparabilitatea.",
    description:
      "Permite unui client să fie onest despre prospețime. `comparability` spune că 89,3% dintre " +
      "produsele cu preț au exact un magazin — un client care vrea să scrie „comparăm 16 magazine” citește aici de ce să nu o facă.",
    params: META_PARAMS,
    pathParams: [],
    limit: "apiRead",
    cache: { sMaxAge: 900, swr: 3600 },
  },
] as const;
