import {readFileSync} from 'node:fs';
const APPROXIMATE_COSTS=JSON.parse(readFileSync(new URL('./project-approximate-costs.json',import.meta.url),'utf8'));
// What candidates actually promise, in the words they actually use.
//
// The 360-entry framework in project-framework.js answers "what KIND of
// development is this" -- "Household economic-strengthening initiatives",
// "Integrated vulnerable-household support". That is the right vocabulary for
// the campaign document and for reporting by sector.
//
// It is not the vocabulary of the proposals candidates hand in. Those read:
//
//     Ikereku ........ Sewing machine, Solar and Palliative
//     Yejuade ........ Transformer fixing cables, Culvert, Borehole
//     Ward 1 ......... 1 borehole and 50 streetlight
//     Constituency ... 10 motorcycles, 1220 bags of fertiliser
//
// A candidate holding that sheet cannot find "sewing machine", "transformer",
// "motorcycle", "fertiliser" or "palliative" anywhere in the framework's 360
// options, because none of them are there. So this is the second half of the
// vocabulary: concrete deliverables, each with the unit it is counted in and
// the framework sector it rolls up to. Pick an item, type a number, done --
// and sector reporting still works, because every item names one.
//
// `aliases` exist because people write "okada", "keke", "NPK" and "solar
// light", and the search box has to find the item anyway.

import { SECTORS } from './project-framework.js';

/** How a quantity is counted. `null` means the item is not counted at all. */
export const UNITS = [
  'pieces', 'units', 'sets', 'packs', 'bags', 'litres', 'rolls',
  'metres', 'kilometres', 'rooms', 'vehicles', 'animals', 'birds',
  'beneficiaries', 'households', 'students', 'boreholes', 'poles', 'culverts',
];

/**
 * @type {Array<{id: string, label: string, unit: string|null,
 *               sector: string, aliases: string[]}>}
 */
export const ITEMS = [
  /* --------------------------- water and sanitation -------------------------- */
  { id: 'borehole', label: 'Borehole (new)', unit: 'boreholes', 
    sector: 'Water, Sanitation & Hygiene (WASH)',
    aliases: ['borehole', 'water borehole', 'motorised borehole', 'water'] },
  { id: 'borehole_solar', label: 'Solar-powered borehole', unit: 'boreholes', 
    sector: 'Water, Sanitation & Hygiene (WASH)',
    aliases: ['solar borehole', 'solar water'] },
  { id: 'borehole_repair', label: 'Borehole repair', unit: 'boreholes',
    sector: 'Water, Sanitation & Hygiene (WASH)',
    aliases: ['repair borehole', 'rehabilitate borehole', 'fix borehole', 'hand pump repair'] },
  { id: 'water_tank', label: 'Water storage tank', unit: 'units',
    sector: 'Water, Sanitation & Hygiene (WASH)',
    aliases: ['overhead tank', 'storage tank', 'gp tank'] },
  { id: 'standpipe', label: 'Public standpipe / water point', unit: 'units',
    sector: 'Water, Sanitation & Hygiene (WASH)', aliases: ['water point', 'tap'] },
  { id: 'public_toilet', label: 'Public toilet', unit: 'units',
    sector: 'Water, Sanitation & Hygiene (WASH)',
    aliases: ['toilet', 'latrine', 'vip toilet'] },

  /* -------------------------- power and public lighting ---------------------- */
  { id: 'solar_street_light', label: 'Solar street light', unit: 'pieces', 
    sector: 'Electricity & Public Lighting',
    aliases: ['solar light', 'street light', 'streetlight', 'solar streetlight', 'light'] },
  { id: 'street_light_repair', label: 'Street light repair / replacement', unit: 'pieces',
    sector: 'Electricity & Public Lighting',
    aliases: ['repair street light', 'replace street light', 'fix light'] },
  { id: 'transformer', label: 'Transformer (new)', unit: 'units', 
    sector: 'Electricity & Public Lighting',
    aliases: ['transformer', 'new transformer', 'distribution transformer'] },
  { id: 'transformer_repair', label: 'Transformer repair', unit: 'units',
    sector: 'Electricity & Public Lighting',
    aliases: ['fix transformer', 'transformer cables', 'transformer fixing',
      'repair transformer', 'rewinding'] },
  { id: 'electric_pole', label: 'Electric pole (concrete)', unit: 'poles',
    sector: 'Electricity & Public Lighting',
    aliases: ['concrete pole', 'electricity pole', 'pole', 'high tension pole'] },
  { id: 'electric_cable', label: 'Electric cables / wiring', unit: 'rolls',
    sector: 'Electricity & Public Lighting',
    aliases: ['cable', 'wire', 'wiring', 'armoured cable'] },
  { id: 'power_extension', label: 'Extension of power lines', unit: 'metres',
    sector: 'Electricity & Public Lighting',
    aliases: ['extend electricity', 'power extension', 'rural electrification'] },
  { id: 'solar_home_system', label: 'Solar home system / lantern', unit: 'units',
    sector: 'Electricity & Public Lighting',
    aliases: ['solar lantern', 'solar panel', 'inverter'] },
  { id: 'generator', label: 'Generator', unit: 'units',
    sector: 'Electricity & Public Lighting', aliases: ['gen', 'generating set'] },

  /* ----------------------------- roads and drainage -------------------------- */
  { id: 'road_grading', label: 'Road grading', unit: 'kilometres',
    sector: 'Roads & Mobility',
    aliases: ['grading', 'grade road', 'bulldozing', 'road opening'] },
  { id: 'road_filling', label: 'Road filling (laterite / rubble)', unit: 'kilometres',
    sector: 'Roads & Mobility',
    aliases: ['rubbles', 'rubble', 'laterite', 'filling of road', 'sharp sand'] },
  { id: 'road_asphalt', label: 'Road surfacing / asphalt', unit: 'kilometres',
    sector: 'Roads & Mobility', aliases: ['tarring', 'asphalt', 'paving', 'interlocking'] },
  { id: 'pothole_repair', label: 'Pothole repair', unit: 'metres',
    sector: 'Roads & Mobility', aliases: ['potholes', 'patching'] },
  { id: 'culvert', label: 'Culvert', unit: 'culverts',
    sector: 'Roads & Mobility', aliases: ['culvert', 'box culvert'] },
  { id: 'drainage', label: 'Drainage channel', unit: 'metres',
    sector: 'Flooding & Drainage',
    aliases: ['drainage', 'gutter', 'canal', 'water channel'] },
  { id: 'erosion_control', label: 'Erosion control', unit: 'metres',
    sector: 'Flooding & Drainage', aliases: ['erosion', 'gully'] },
  { id: 'bridge', label: 'Bridge / footbridge', unit: 'units',
    sector: 'Roads & Mobility', aliases: ['bridge', 'foot bridge'] },

  /* -------------------- equipment for trades and enterprise ------------------ */
  { id: 'sewing_machine', label: 'Sewing machine', unit: 'pieces',
    sector: 'SMEs & Local Enterprise',
    aliases: ['sewing machine', 'tailoring machine', 'tailor', 'machine'] },
  { id: 'grinding_machine', label: 'Grinding machine', unit: 'pieces',
    sector: 'SMEs & Local Enterprise', aliases: ['grinder', 'milling machine', 'mill'] },
  { id: 'hairdressing_kit', label: 'Hairdressing / barbing equipment', unit: 'sets',
    sector: 'SMEs & Local Enterprise', aliases: ['dryer', 'clipper', 'salon', 'barbing'] },
  { id: 'welding_machine', label: 'Welding machine', unit: 'pieces',
    sector: 'SMEs & Local Enterprise', aliases: ['welder', 'welding'] },
  { id: 'block_machine', label: 'Block-moulding machine', unit: 'pieces',
    sector: 'SMEs & Local Enterprise', aliases: ['block machine', 'block moulding'] },
  { id: 'deep_freezer', label: 'Deep freezer', unit: 'pieces',
    sector: 'SMEs & Local Enterprise', aliases: ['freezer', 'fridge'] },
  { id: 'trader_kit', label: 'Trader starter kit', unit: 'sets',
    sector: 'SMEs & Local Enterprise',
    aliases: ['petty trading', 'wheelbarrow', 'kiosk'] },
  { id: 'cash_grant', label: 'Business start-up grant', unit: 'beneficiaries',
    sector: 'SMEs & Local Enterprise',
    aliases: ['grant', 'cash grant', 'seed capital', 'empowerment fund', 'soft loan'] },
  { id: 'market_stall', label: 'Market stall / lock-up shop', unit: 'units',
    sector: 'Markets & Local Commerce', aliases: ['stall', 'shop', 'lock up'] },
  { id: 'market_shed', label: 'Market shed', unit: 'units',
    sector: 'Markets & Local Commerce', aliases: ['shed', 'market building'] },

  /* --------------------------------- transport ------------------------------- */
  { id: 'motorcycle', label: 'Motorcycle', unit: 'units',
    sector: 'Transport & Public Access',
    aliases: ['okada', 'bike', 'motor cycle', 'motorbike'] },
  { id: 'tricycle', label: 'Tricycle', unit: 'units',
    sector: 'Transport & Public Access',
    aliases: ['keke', 'keke napep', 'keke marwa', 'napep'] },
  { id: 'bus_shelter', label: 'Bus stop shelter', unit: 'units',
    sector: 'Transport & Public Access', aliases: ['bus stop', 'shelter'] },
  { id: 'motor_park', label: 'Motor park rehabilitation', unit: 'units',
    sector: 'Transport & Public Access', aliases: ['garage', 'park'] },

  /* -------------------------------- agriculture ------------------------------ */
  { id: 'fertiliser', label: 'Fertiliser', unit: 'bags',
    sector: 'Agriculture & Food Security',
    aliases: ['fertilizer', 'npk', 'urea', 'manure', 'bags of fertilizer'] },
  { id: 'seeds', label: 'Improved seeds / seedlings', unit: 'bags',
    sector: 'Agriculture & Food Security',
    aliases: ['seed', 'seedling', 'maize seed', 'cassava stem'] },
  { id: 'agrochemicals', label: 'Agrochemicals / herbicide', unit: 'litres',
    sector: 'Agriculture & Food Security',
    aliases: ['herbicide', 'pesticide', 'weed killer'] },
  { id: 'sprayer', label: 'Knapsack sprayer', unit: 'pieces',
    sector: 'Agriculture & Food Security', aliases: ['sprayer', 'knapsack'] },
  { id: 'farm_tools', label: 'Farm tools (cutlass, hoe)', unit: 'sets',
    sector: 'Agriculture & Food Security',
    aliases: ['cutlass', 'hoe', 'machete', 'implements'] },
  { id: 'livestock', label: 'Livestock (goats, sheep, rams)', unit: 'animals',
    sector: 'Agriculture & Food Security', aliases: ['goat', 'sheep', 'ram', 'animal'] },
  { id: 'poultry', label: 'Poultry starter pack', unit: 'birds',
    sector: 'Agriculture & Food Security',
    aliases: ['chicken', 'birds', 'layers', 'broilers'] },
  { id: 'fishery', label: 'Fish pond / fingerlings', unit: 'units',
    sector: 'Agriculture & Food Security', aliases: ['fish', 'fingerlings', 'pond'] },
  { id: 'tractor_support', label: 'Tractor hiring support', unit: 'beneficiaries',
    sector: 'Agriculture & Food Security',
    aliases: ['tractor', 'ploughing', 'mechanisation'] },
  { id: 'processing_machine', label: 'Cassava / maize processing machine', unit: 'pieces',
    sector: 'Agriculture & Food Security', aliases: ['garri', 'processing', 'thresher'] },

  /* ---------------------------- relief and palliatives ----------------------- */
  { id: 'palliative_food', label: 'Food palliative pack', unit: 'packs',
    sector: 'Social Protection',
    aliases: ['palliative', 'palliatives', 'food items', 'relief materials', 'food pack'] },
  { id: 'rice', label: 'Bag of rice', unit: 'bags',
    sector: 'Social Protection', aliases: ['rice', 'bag of rice'] },
  { id: 'festive_relief', label: 'Festive relief (Ramadan / Christmas)', unit: 'packs',
    sector: 'Social Protection',
    aliases: ['ramadan', 'sallah', 'christmas', 'eid', 'ileya'] },
  { id: 'cash_palliative', label: 'Cash palliative', unit: 'beneficiaries',
    sector: 'Social Protection', aliases: ['cash', 'stipend', 'money'] },
  { id: 'medical_outreach', label: 'Free medical outreach', unit: 'beneficiaries',
    sector: 'Primary Healthcare',
    aliases: ['outreach', 'free health', 'screening', 'medical mission'] },
  { id: 'free_drugs', label: 'Free drugs distribution', unit: 'beneficiaries',
    sector: 'Primary Healthcare', aliases: ['drugs', 'medicine'] },
  { id: 'mosquito_nets', label: 'Mosquito nets', unit: 'pieces',
    sector: 'Primary Healthcare', aliases: ['net', 'llin', 'treated net'] },

  /* --------------------------------- education ------------------------------- */
  { id: 'classroom_block', label: 'Block of classrooms', unit: 'rooms',
    sector: 'Education', aliases: ['classroom', 'school building'] },
  { id: 'school_renovation', label: 'School renovation', unit: 'rooms',
    sector: 'Education', aliases: ['renovate school', 'roofing', 'school repair'] },
  { id: 'school_furniture', label: 'School desks and chairs', unit: 'sets',
    sector: 'Education', aliases: ['desk', 'chair', 'furniture', 'benches'] },
  { id: 'scholarship', label: 'Scholarship / bursary', unit: 'students',
    sector: 'Education', aliases: ['scholarship', 'bursary', 'school fees'] },
  { id: 'exam_fees', label: 'Exam fee support (WAEC / NECO / JAMB)', unit: 'students',
    sector: 'Education', aliases: ['waec', 'neco', 'jamb', 'exam fee'] },
  { id: 'school_books', label: 'Books and writing materials', unit: 'sets',
    sector: 'Education', aliases: ['books', 'exercise book', 'stationery', 'uniform'] },
  { id: 'ict_equipment', label: 'Computers / ICT equipment', unit: 'units',
    sector: 'Digital Inclusion', aliases: ['computer', 'laptop', 'ict', 'projector'] },
  { id: 'school_fence', label: 'School perimeter fence', unit: 'metres',
    sector: 'Education', aliases: ['fence', 'perimeter'] },

  /* ------------------------------ primary health ----------------------------- */
  { id: 'phc_renovation', label: 'Health centre renovation', unit: 'units',
    sector: 'Primary Healthcare',
    aliases: ['phc', 'health centre', 'clinic', 'dispensary'] },
  { id: 'medical_equipment', label: 'Medical equipment', unit: 'units',
    sector: 'Primary Healthcare', aliases: ['equipment', 'bed', 'delivery kit'] },
  { id: 'maternal_pack', label: 'Maternal / delivery pack', unit: 'packs',
    sector: 'Primary Healthcare', aliases: ['mama kit', 'delivery pack', 'pregnant'] },
  { id: 'ambulance', label: 'Ambulance / tricycle ambulance', unit: 'vehicles',
    sector: 'Primary Healthcare', aliases: ['ambulance'] },
  { id: 'health_insurance', label: 'Health insurance enrolment', unit: 'beneficiaries',
    sector: 'Primary Healthcare', aliases: ['insurance', 'nhis', 'oyshia'] },

  /* --------------------------- community and safety -------------------------- */
  { id: 'town_hall', label: 'Town hall / community centre', unit: 'units',
    sector: 'Community & Civic Infrastructure',
    aliases: ['town hall', 'community centre', 'hall'] },
  { id: 'worship_support', label: 'Place of worship support', unit: 'units',
    sector: 'Community & Civic Infrastructure',
    aliases: ['mosque', 'church', 'central mosque', 'can', 'muslim community'] },
  { id: 'security_post', label: 'Security post / checkpoint', unit: 'units',
    sector: 'Community Safety',
    aliases: ['security post', 'checkpoint', 'police post'] },
  { id: 'vigilante_support', label: 'Vigilante / local security support', unit: 'beneficiaries',
    sector: 'Community Safety',
    aliases: ['vigilante', 'amotekun', 'local security', 'hunters'] },
  { id: 'security_vehicle', label: 'Security patrol vehicle / motorcycle', unit: 'vehicles',
    sector: 'Community Safety', aliases: ['patrol van', 'security bike'] },
  { id: 'cctv', label: 'CCTV / surveillance', unit: 'units',
    sector: 'Community Safety', aliases: ['camera', 'cctv'] },
  { id: 'waste_bins', label: 'Waste bins / refuse evacuation', unit: 'units',
    sector: 'Environment & Waste Management',
    aliases: ['bin', 'refuse', 'waste', 'evacuation'] },
  { id: 'cemetery', label: 'Cemetery / burial ground', unit: 'units',
    sector: 'Community & Civic Infrastructure', aliases: ['cemetery', 'burial'] },

  /* -------------------- inclusion, women, youth and sports ------------------- */
  { id: 'wheelchair', label: 'Wheelchair', unit: 'pieces',
    sector: 'Women & Social Inclusion', aliases: ['wheel chair'] },
  { id: 'mobility_aid', label: 'Crutches / walking aid', unit: 'pieces',
    sector: 'Women & Social Inclusion',
    aliases: ['crutch', 'walking stick', 'clutches'] },
  { id: 'sensory_aid', label: 'Hearing aid / eyeglasses', unit: 'pieces',
    sector: 'Women & Social Inclusion',
    aliases: ['hearing aid', 'glasses', 'spectacles'] },
  { id: 'disability_support', label: 'Support for persons with disabilities', unit: 'beneficiaries',
    sector: 'Women & Social Inclusion',
    aliases: ['disability', 'special needs', 'physically challenged', 'pwd'] },
  { id: 'widow_support', label: 'Widow support', unit: 'beneficiaries',
    sector: 'Women & Social Inclusion', aliases: ['widow', 'widows'] },
  { id: 'elderly_support', label: 'Support for elderly persons', unit: 'beneficiaries',
    sector: 'Social Protection',
    aliases: ['elderly', 'aged', 'old people', 'pensioner'] },
  { id: 'skills_training', label: 'Skills / vocational training', unit: 'beneficiaries',
    sector: 'Youth Skills & Employment',
    aliases: ['training', 'vocational', 'skill acquisition', 'apprenticeship'] },
  { id: 'sports_kit', label: 'Sports kits / jerseys', unit: 'sets',
    sector: 'Sports & Youth Development', aliases: ['jersey', 'football kit', 'boots'] },
  { id: 'sports_competition', label: 'Sports competition sponsorship', unit: 'units',
    sector: 'Sports & Youth Development',
    aliases: ['tournament', 'competition', 'novelty match'] },
  { id: 'playing_field', label: 'Playing field / pitch improvement', unit: 'units',
    sector: 'Sports & Youth Development', aliases: ['field', 'pitch', 'playground'] },

  /* ----------------------------------- other --------------------------------- */
  { id: 'other', label: 'Something else (describe it)', unit: null,
    sector: 'Community Data & Planning', aliases: ['other', 'misc'] },
];

for(const item of ITEMS){
  const estimate=APPROXIMATE_COSTS[item.id];
  if(estimate)Object.assign(item,{unit_cost:estimate.unit_cost,cost_unit:estimate.unit,cost_estimate:estimate.estimate,cost_specification:estimate.specification,cost_source:estimate.source_file});
}

export const ITEMS_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/** Resolve the fixed unit price from an item id or the framework's wording. */
export function unitCostForProject(project = {}) {
  const item = ITEMS_BY_ID[project.item_id];
  if (item?.unit_cost != null) return item.unit_cost;

  const namedItem=findItem(project.project_name)||findItem(project.title);
  if(namedItem?.unit_cost!=null)return namedItem.unit_cost;
  const name = norm([project.project_name, project.title].filter(Boolean).join(' '));
  const repair = /repair|rehabilitat|cable|rewind/.test(name);
  if (/solar/.test(name) && /borehole/.test(name)) return ITEMS_BY_ID.borehole_solar.unit_cost;
  if (/solar/.test(name) && /street ?lights?/.test(name)) return ITEMS_BY_ID.solar_street_light.unit_cost;
  if (/transformer/.test(name) && !repair) return ITEMS_BY_ID.transformer.unit_cost;
  if (/borehole/.test(name) && !repair && !/solar/.test(name)) return ITEMS_BY_ID.borehole.unit_cost;
  return null;
}

/** A saved budget overrides the estimate; otherwise calculate price x quantity. */
export function estimatedProjectCost(project = {}) {
  if (project.budget != null && String(project.budget).trim() !== '') {
    const budget = Number(project.budget);
    if (Number.isFinite(budget) && budget >= 0) return budget;
  }
  const unitCost = unitCostForProject(project);
  if (unitCost == null) return null;
  return unitCost * Math.max(1, Number(project.quantity) || 1);
}

/** Items grouped by the framework sector they report under. */
export const ITEMS_BY_SECTOR = SECTORS.reduce((acc, sector) => {
  acc[sector] = ITEMS.filter((i) => i.sector === sector);
  return acc;
}, {});

const norm = (s) => String(s || '').trim().toLowerCase();

/** Resolve an id, a label, or one of the aliases people actually type. */
export function findItem(term) {
  const want = norm(term);
  if (!want) return null;
  return ITEMS.find((i) => i.id === want)
    || ITEMS.find((i) => norm(i.label) === want)
    || ITEMS.find((i) => i.aliases.some((a) => norm(a) === want))
    || null;
}

/**
 * Type-ahead. Exact hits first, then labels or aliases starting with the term,
 * then anything the term merely appears in -- so "solar" offers the street
 * light before the borehole, and "okada" finds the motorcycle.
 */
export function searchItems(term, limit = 12) {
  const want = norm(term);
  if (!want) return ITEMS.slice(0, limit);

  const exact = [];
  const starts = [];
  const holds = [];
  for (const item of ITEMS) {
    if (item.id === 'other') continue;
    const label = norm(item.label);
    const aliases = item.aliases.map(norm);
    if (label === want || aliases.includes(want)) exact.push(item);
    else if (label.startsWith(want) || aliases.some((a) => a.startsWith(want))) starts.push(item);
    else if (label.includes(want) || aliases.some((a) => a.includes(want))) holds.push(item);
  }
  return [...exact, ...starts, ...holds].slice(0, limit);
}
