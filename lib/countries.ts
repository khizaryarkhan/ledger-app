/**
 * Full ISO 3166-1 alpha-2 country list (code + name), used for billing/tax
 * addresses (Stripe expects the alpha-2 code). A few common markets are pinned
 * to the top for convenience; the rest follow alphabetically.
 */

export type Country = { code: string; name: string };

const PINNED: Country[] = [
  { code: "IE", name: "Ireland" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

const REST: Country[] = [
  { code: "AF", name: "Afghanistan" }, { code: "AX", name: "Åland Islands" }, { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" }, { code: "AS", name: "American Samoa" }, { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" }, { code: "AI", name: "Anguilla" }, { code: "AQ", name: "Antarctica" },
  { code: "AG", name: "Antigua and Barbuda" }, { code: "AR", name: "Argentina" }, { code: "AM", name: "Armenia" },
  { code: "AW", name: "Aruba" }, { code: "AU", name: "Australia" }, { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" }, { code: "BS", name: "Bahamas" }, { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" }, { code: "BB", name: "Barbados" }, { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" }, { code: "BZ", name: "Belize" }, { code: "BJ", name: "Benin" },
  { code: "BM", name: "Bermuda" }, { code: "BT", name: "Bhutan" }, { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina" }, { code: "BW", name: "Botswana" }, { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" }, { code: "BG", name: "Bulgaria" }, { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" }, { code: "KH", name: "Cambodia" }, { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" }, { code: "CV", name: "Cape Verde" }, { code: "KY", name: "Cayman Islands" },
  { code: "CF", name: "Central African Republic" }, { code: "TD", name: "Chad" }, { code: "CL", name: "Chile" },
  { code: "CN", name: "China" }, { code: "CO", name: "Colombia" }, { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" }, { code: "CD", name: "Congo (DRC)" }, { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Côte d'Ivoire" }, { code: "HR", name: "Croatia" }, { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" }, { code: "CZ", name: "Czechia" }, { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" }, { code: "DM", name: "Dominica" }, { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" }, { code: "EG", name: "Egypt" }, { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" }, { code: "ER", name: "Eritrea" }, { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" }, { code: "ET", name: "Ethiopia" }, { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" }, { code: "FR", name: "France" }, { code: "GF", name: "French Guiana" },
  { code: "PF", name: "French Polynesia" }, { code: "GA", name: "Gabon" }, { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" }, { code: "DE", name: "Germany" }, { code: "GH", name: "Ghana" },
  { code: "GI", name: "Gibraltar" }, { code: "GR", name: "Greece" }, { code: "GL", name: "Greenland" },
  { code: "GD", name: "Grenada" }, { code: "GP", name: "Guadeloupe" }, { code: "GU", name: "Guam" },
  { code: "GT", name: "Guatemala" }, { code: "GG", name: "Guernsey" }, { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" }, { code: "GY", name: "Guyana" }, { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" }, { code: "HK", name: "Hong Kong" }, { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" }, { code: "IN", name: "India" }, { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" }, { code: "IQ", name: "Iraq" }, { code: "IM", name: "Isle of Man" },
  { code: "IL", name: "Israel" }, { code: "IT", name: "Italy" }, { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" }, { code: "JE", name: "Jersey" }, { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" }, { code: "KE", name: "Kenya" }, { code: "KI", name: "Kiribati" },
  { code: "KW", name: "Kuwait" }, { code: "KG", name: "Kyrgyzstan" }, { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" }, { code: "LB", name: "Lebanon" }, { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" }, { code: "LY", name: "Libya" }, { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" }, { code: "LU", name: "Luxembourg" }, { code: "MO", name: "Macao" },
  { code: "MG", name: "Madagascar" }, { code: "MW", name: "Malawi" }, { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" }, { code: "ML", name: "Mali" }, { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" }, { code: "MQ", name: "Martinique" }, { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" }, { code: "MX", name: "Mexico" }, { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova" }, { code: "MC", name: "Monaco" }, { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" }, { code: "MS", name: "Montserrat" }, { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" }, { code: "MM", name: "Myanmar" }, { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" }, { code: "NP", name: "Nepal" }, { code: "NL", name: "Netherlands" },
  { code: "NC", name: "New Caledonia" }, { code: "NZ", name: "New Zealand" }, { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" }, { code: "NG", name: "Nigeria" }, { code: "MK", name: "North Macedonia" },
  { code: "NO", name: "Norway" }, { code: "OM", name: "Oman" }, { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" }, { code: "PS", name: "Palestine" }, { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" }, { code: "PY", name: "Paraguay" }, { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" }, { code: "PL", name: "Poland" }, { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" }, { code: "QA", name: "Qatar" }, { code: "RE", name: "Réunion" },
  { code: "RO", name: "Romania" }, { code: "RU", name: "Russia" }, { code: "RW", name: "Rwanda" },
  { code: "WS", name: "Samoa" }, { code: "SM", name: "San Marino" }, { code: "ST", name: "São Tomé and Príncipe" },
  { code: "SA", name: "Saudi Arabia" }, { code: "SN", name: "Senegal" }, { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" }, { code: "SL", name: "Sierra Leone" }, { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" }, { code: "SI", name: "Slovenia" }, { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" }, { code: "ZA", name: "South Africa" }, { code: "KR", name: "South Korea" },
  { code: "SS", name: "South Sudan" }, { code: "ES", name: "Spain" }, { code: "LK", name: "Sri Lanka" },
  { code: "KN", name: "St Kitts and Nevis" }, { code: "LC", name: "St Lucia" }, { code: "VC", name: "St Vincent" },
  { code: "SD", name: "Sudan" }, { code: "SR", name: "Suriname" }, { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" }, { code: "SY", name: "Syria" }, { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" }, { code: "TZ", name: "Tanzania" }, { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" }, { code: "TG", name: "Togo" }, { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" }, { code: "TN", name: "Tunisia" }, { code: "TR", name: "Türkiye" },
  { code: "TM", name: "Turkmenistan" }, { code: "TC", name: "Turks and Caicos" }, { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" }, { code: "UA", name: "Ukraine" }, { code: "AE", name: "United Arab Emirates" },
  { code: "UY", name: "Uruguay" }, { code: "UZ", name: "Uzbekistan" }, { code: "VU", name: "Vanuatu" },
  { code: "VA", name: "Vatican City" }, { code: "VE", name: "Venezuela" }, { code: "VN", name: "Vietnam" },
  { code: "VG", name: "Virgin Islands (British)" }, { code: "VI", name: "Virgin Islands (US)" },
  { code: "YE", name: "Yemen" }, { code: "ZM", name: "Zambia" }, { code: "ZW", name: "Zimbabwe" },
  // Added 2026-11-20: the 28 ISO 3166-1 codes this list was missing. Checked
  // against the datahub "country-list" dataset (ISO 3166-1 alpha-2, 249 rows,
  // raw.githubusercontent.com/datasets/country-list/main/data.csv); names are
  // that dataset's. tests/countries.test.ts pins the count at 249.
  { code: "BL", name: "Saint Barthélemy" }, { code: "BQ", name: "Bonaire, Sint Eustatius and Saba" },
  { code: "BV", name: "Bouvet Island" }, { code: "CC", name: "Cocos (Keeling) Islands" }, { code: "CK", name: "Cook Islands" },
  { code: "CW", name: "Curaçao" }, { code: "CX", name: "Christmas Island" }, { code: "EH", name: "Western Sahara" },
  { code: "FK", name: "Falkland Islands (Malvinas)" }, { code: "FO", name: "Faroe Islands" },
  { code: "GS", name: "South Georgia and the South Sandwich Islands" }, { code: "HM", name: "Heard Island and McDonald Islands" },
  { code: "IO", name: "British Indian Ocean Territory" }, { code: "KP", name: "North Korea" },
  { code: "MF", name: "Saint Martin (French part)" }, { code: "MP", name: "Northern Mariana Islands" },
  { code: "NF", name: "Norfolk Island" }, { code: "NU", name: "Niue" }, { code: "PM", name: "Saint Pierre and Miquelon" },
  { code: "PN", name: "Pitcairn" }, { code: "SH", name: "Saint Helena, Ascension and Tristan da Cunha" },
  { code: "SJ", name: "Svalbard and Jan Mayen" }, { code: "SX", name: "Sint Maarten (Dutch part)" },
  { code: "TF", name: "French Southern Territories" }, { code: "TK", name: "Tokelau" },
  { code: "UM", name: "United States Minor Outlying Islands" }, { code: "WF", name: "Wallis and Futuna" },
  { code: "YT", name: "Mayotte" },
].sort((a, b) => a.name.localeCompare(b.name));

export const COUNTRIES: Country[] = [...PINNED, ...REST];

// ─────────────────────────────────────────────────────────────────────────────
// Country CODES for documents and EDI (2026-11-20).
//
// EDI addresses carry an ISO 3166-1 alpha-2 code, never a name. The app stored
// country as free text (parties.country, organisations.address_country) or as
// a name in the org's own `countries` list, which no partner system can read
// reliably. These helpers turn either into a code, or refuse.
// ─────────────────────────────────────────────────────────────────────────────

const BY_CODE = new Map(COUNTRIES.map(c => [c.code, c]));

/** The country for a code (any case), or undefined when it is not an ISO 3166-1 code. */
export const countryByCode = (code?: string | null): Country | undefined =>
  code ? BY_CODE.get(String(code).trim().toUpperCase()) : undefined;

/** A country code in canonical form ("gb" -> "GB"), or null when it is not an ISO code. */
export const normaliseCountryCode = (code?: string | null): string | null => countryByCode(code)?.code ?? null;

/** Why a country code the user sent cannot be stored, or null. Empty is allowed. */
export function countryCodeError(v: unknown, label = "Country"): string | null {
  if (v == null || String(v).trim() === "") return null;
  return countryByCode(String(v)) ? null : `${label} "${String(v).trim()}" is not an ISO 3166 country code.`;
}

/** Case, accents, spaces and punctuation are ignored when matching a name. */
const nameKey = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Names that are not the friendly name above but mean exactly one country.
 * The first block is the ISO short name wherever it differs from ours, computed
 * against tests/fixtures/iso-3166-1.txt (and pinned by tests/countries.test.ts);
 * the second is a short list of names people commonly type.
 */
const ALIASES: Record<string, string> = {
  "Bolivia, Plurinational State of": "BO", "Brunei Darussalam": "BN", "Cabo Verde": "CV",
  "Congo, The Democratic Republic of the": "CD", "Holy See (Vatican City State)": "VA", "Iran, Islamic Republic of": "IR",
  "Korea, Democratic People's Republic of": "KP", "Korea, Republic of": "KR", "Lao People's Democratic Republic": "LA",
  "Micronesia, Federated States of": "FM", "Moldova, Republic of": "MD", "Palestine, State of": "PS",
  "Russian Federation": "RU", "Saint Kitts and Nevis": "KN", "Saint Lucia": "LC", "Saint Vincent and the Grenadines": "VC",
  "Sao Tome and Principe": "ST", "Syrian Arab Republic": "SY", "Taiwan, Province of China": "TW",
  "Tanzania, United Republic of": "TZ", "Turks and Caicos Islands": "TC", "Venezuela, Bolivarian Republic of": "VE",
  "Viet Nam": "VN", "Virgin Islands, British": "VG", "Virgin Islands, U.S.": "VI",

  "UK": "GB", "Great Britain": "GB", "Britain": "GB", "England": "GB", "Scotland": "GB", "Wales": "GB",
  "Northern Ireland": "GB", "United Kingdom of Great Britain and Northern Ireland": "GB",
  "USA": "US", "US": "US", "United States of America": "US",
  "Republic of Ireland": "IE", "Eire": "IE", "Holland": "NL", "The Netherlands": "NL", "UAE": "AE",
  "Turkey": "TR", "Czech Republic": "CZ", "Macedonia": "MK", "Ivory Coast": "CI", "Swaziland": "SZ", "Burma": "MM",
  "Democratic Republic of the Congo": "CD", "DRC": "CD", "Republic of the Congo": "CG",
};

const BY_NAME = new Map<string, string>([
  ...COUNTRIES.map(c => [nameKey(c.name), c.code] as [string, string]),
  ...Object.entries(ALIASES).map(([n, code]) => [nameKey(n), code] as [string, string]),
]);

/**
 * The ISO code a stored country NAME means, or null. Exact name or explicit
 * alias only: "Ireland" -> IE, "UK" -> GB, "Viet Nam" -> VN. A name that
 * matches nothing gets NO code rather than a nearest match, so the gap stays
 * visible (the EDI pre-send check names it) instead of becoming a wrong
 * country on a partner's document.
 */
export function countryCodeFromName(name?: string | null): string | null {
  const k = nameKey(String(name ?? ""));
  return k ? BY_NAME.get(k) ?? null : null;
}
