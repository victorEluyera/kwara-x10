// GENERATED FILE -- do not edit by hand.
//
// The campaign's Community & Constituency Development Project Framework:
// 20 development sectors, each with six example projects at each of three
// scales. 360 options in total.
//
// Scale is not a label on a project, it changes which projects exist. A
// borehole is "Repair/rehabilitation of boreholes" when small, "Solar-powered
// boreholes" when medium, and part of a "Multi-community water scheme" when
// large -- three different undertakings, so the scale is chosen first.

/** What each scale is for, in the framework's own words. */
export const SCALES = [
  { id: 'small', label: 'Small',
    blurb: 'Serves a street, village, school, neighbourhood or specific beneficiary group.' },
  { id: 'medium', label: 'Medium',
    blurb: 'Serves a ward, cluster of communities or part of an LGA.' },
  { id: 'large', label: 'Large',
    blurb: 'Constituency-wide, multi-ward or strategic infrastructure impact.' },
];

export const SCALE_IDS = SCALES.map((s) => s.id);

/** A project is a promise until someone says otherwise. */
export const PROJECT_STATUSES = [
  { id: 'promised', label: 'Promised', blurb: 'Intended. No work started yet.' },
  { id: 'ongoing', label: 'Ongoing', blurb: 'Work has begun.' },
  { id: 'completed', label: 'Completed', blurb: 'Delivered.' },
];

export const STATUS_IDS = PROJECT_STATUSES.map((s) => s.id);

export const FRAMEWORK = {
  "Water, Sanitation & Hygiene (WASH)": {
    small: [
      "Repair/rehabilitation of boreholes",
      "Handwashing stations",
      "Community water-point repairs",
      "Public/community toilets",
      "Water-storage tanks",
      "Hygiene and sanitation campaigns",
    ],
    medium: [
      "Solar-powered boreholes",
      "Elevated storage tanks",
      "Multiple standpipes",
      "School WASH facilities",
      "PHC WASH facilities",
      "Community sanitation blocks",
    ],
    large: [
      "Multi-community water schemes",
      "Water-reticulation networks",
      "Large solar-powered water systems",
      "Water-treatment facilities",
      "Multi-community sanitation programme",
      "Integrated water-distribution infrastructure",
    ],
  },
  "Education": {
    small: [
      "Desks and chairs",
      "Books and learning materials",
      "Minor classroom repairs",
      "School painting and maintenance",
      "Scholarships/bursary support",
      "WAEC/NECO/JAMB support programmes",
    ],
    medium: [
      "Classroom-block rehabilitation",
      "New classroom blocks",
      "ICT laboratories",
      "Science laboratories",
      "School toilet facilities",
      "Libraries and learning centres",
    ],
    large: [
      "New school complexes",
      "Major school rehabilitation",
      "Technical/vocational institutes",
      "Constituency ICT learning centres",
      "Science and innovation centres",
      "Multi-school improvement programmes",
    ],
  },
  "Primary Healthcare": {
    small: [
      "Community medical outreach",
      "Basic medical equipment",
      "Maternal and child-health support",
      "Health-screening programmes",
      "Health-awareness campaigns",
      "First-aid equipment",
    ],
    medium: [
      "PHC rehabilitation",
      "Solarisation of health facilities",
      "Water systems",
      "Medical equipment",
      "Staff facilities",
      "Maternal/child-health units",
    ],
    large: [
      "New PHCs",
      "Comprehensive PHC upgrades",
      "Diagnostic centres",
      "Maternal and child-health centres",
      "Multi-community health programmes",
      "Integrated health-service facilities",
    ],
  },
  "Roads & Mobility": {
    small: [
      "Pothole repairs",
      "Footpaths and walkways",
      "Road and directional signs",
      "Small culverts",
      "Pedestrian access improvements",
      "Community road clearing",
    ],
    medium: [
      "Feeder-road rehabilitation",
      "Drainage construction",
      "Culverts",
      "Pedestrian bridges",
      "Bus shelters",
      "Community access-road improvements",
    ],
    large: [
      "Major access-road construction",
      "Strategic road rehabilitation",
      "Bridges",
      "Large drainage systems",
      "Multi-community road networks",
      "Strategic rural-access corridors",
    ],
  },
  "Electricity & Public Lighting": {
    small: [
      "Solar security lights",
      "Market lighting",
      "School lighting",
      "PHC lighting",
      "Lighting of community spaces",
      "Replacement of damaged public lights",
    ],
    medium: [
      "Ward-level solar streetlights",
      "Solar systems for schools",
      "Solar systems for PHCs",
      "Public-facility electrification",
      "Solar market lighting",
      "Community renewable-energy installations",
    ],
    large: [
      "Solar mini-grids",
      "Rural electrification schemes",
      "Large-scale solar streetlighting",
      "Multi-community energy systems",
      "Solarisation of public facilities",
      "Renewable-energy infrastructure",
    ],
  },
  "Agriculture & Food Security": {
    small: [
      "Seeds and seedlings",
      "Basic farm tools",
      "Farmer training",
      "Demonstration farms",
      "Poultry/fishery starter support",
      "Extension-awareness programmes",
    ],
    medium: [
      "Small irrigation systems",
      "Produce aggregation centres",
      "Farm-processing equipment",
      "Cooperative mechanisation support",
      "Storage facilities",
      "Extension and demonstration centres",
    ],
    large: [
      "Large irrigation schemes",
      "Agro-processing centres",
      "Produce aggregation hubs",
      "Storage and warehouse complexes",
      "Cold-chain infrastructure",
      "Agricultural service centres",
    ],
  },
  "Youth Skills & Employment": {
    small: [
      "Vocational short courses",
      "Digital-skills training",
      "Career clinics",
      "Apprenticeship placement",
      "Employability workshops",
      "Entrepreneurship orientation",
    ],
    medium: [
      "Skills-acquisition centres",
      "Equipment-supported vocational training",
      "Entrepreneurship programmes",
      "Apprenticeship schemes",
      "Digital-skills centres",
      "Job-placement programmes",
    ],
    large: [
      "Vocational institutes",
      "Innovation hubs",
      "Enterprise centres",
      "Constituency employability programmes",
      "Technology training campuses",
      "Youth entrepreneurship centres",
    ],
  },
  "SMEs & Local Enterprise": {
    small: [
      "Business clinics",
      "Bookkeeping training",
      "Cooperative formation",
      "Product-packaging training",
      "Digital-marketing training",
      "Business-registration support",
    ],
    medium: [
      "Shared production equipment",
      "Microenterprise support centres",
      "Market digitisation",
      "Cooperative production facilities",
      "SME advisory centres",
      "Business incubation programmes",
    ],
    large: [
      "Enterprise-development centres",
      "Industrial clusters",
      "MSME incubation facilities",
      "Shared manufacturing facilities",
      "Business-support hubs",
      "Local enterprise parks",
    ],
  },
  "Digital Inclusion": {
    small: [
      "Digital-literacy training",
      "Computers for schools",
      "Community Wi-Fi pilots",
      "Coding workshops",
      "Basic GIS training",
      "Digital-access support for students",
    ],
    medium: [
      "ICT centres",
      "Digital-learning hubs",
      "Coding laboratories",
      "GIS laboratories",
      "Community internet centres",
      "School digital-learning facilities",
    ],
    large: [
      "Constituency digital innovation hubs",
      "Broadband-connected learning networks",
      "Digital-skills academies",
      "Public internet-access networks",
      "Integrated digital-learning platforms",
      "Technology innovation centres",
    ],
  },
  "Markets & Local Commerce": {
    small: [
      "Market sanitation",
      "Minor stall repairs",
      "Market lighting",
      "Signage and numbering",
      "Waste bins",
      "Basic fire-safety equipment",
    ],
    medium: [
      "Construction/rehabilitation of market stalls",
      "Cold rooms",
      "Market toilets",
      "Solar lighting",
      "Waste-management facilities",
      "Market water supply",
    ],
    large: [
      "Modern community markets",
      "Agricultural produce markets",
      "Commercial hubs",
      "Wholesale/aggregation markets",
      "Integrated market facilities",
      "Market logistics and storage centres",
    ],
  },
  "Environment & Waste Management": {
    small: [
      "Community clean-up",
      "Tree planting",
      "Waste bins",
      "Drain clearing",
      "Environmental-awareness campaigns",
      "Community beautification",
    ],
    medium: [
      "Community recycling initiatives",
      "Waste-collection systems",
      "Community nurseries",
      "Local erosion control",
      "Environmental restoration",
      "Organised waste-transfer points",
    ],
    large: [
      "Integrated waste-management facilities",
      "Major erosion-control works",
      "Large-scale restoration projects",
      "Waste-transfer/recycling centres",
      "Urban greening programmes",
      "Watershed/environmental rehabilitation",
    ],
  },
  "Flooding & Drainage": {
    small: [
      "Clearing blocked drains",
      "Minor drainage repairs",
      "Small channels",
      "Local erosion protection",
      "Flood-awareness campaigns",
      "Identification and mapping of flood-prone points",
    ],
    medium: [
      "Drainage rehabilitation",
      "Culverts",
      "Channel improvements",
      "Erosion protection",
      "Flood-prone-area mapping",
      "Community flood-management works",
    ],
    large: [
      "Major drainage networks",
      "Flood-control infrastructure",
      "Watershed interventions",
      "River/channel rehabilitation",
      "Large erosion-control projects",
      "Integrated flood-risk management",
    ],
  },
  "Community Safety": {
    small: [
      "Public-space lighting",
      "Emergency contact information",
      "Safety-awareness campaigns",
      "Community incident-reporting channels",
      "Safety signage",
      "Emergency-response sensitisation",
    ],
    medium: [
      "Community emergency communication systems",
      "Public-space lighting networks",
      "Incident-reporting platforms",
      "Emergency assembly points",
      "Safety information systems",
      "Coordinated community-response facilities",
    ],
    large: [
      "Integrated community safety platforms",
      "Emergency communication infrastructure",
      "Public-safety coordination centres",
      "Multi-community public lighting",
      "Emergency-response infrastructure",
      "GIS-enabled incident-management systems, in coordination with responsible agencies",
    ],
  },
  "Women & Social Inclusion": {
    small: [
      "Skills training",
      "Livelihood support",
      "Assistive devices",
      "Cooperative development",
      "Financial-literacy training",
      "Women-led enterprise support",
    ],
    medium: [
      "Women enterprise centres",
      "Cooperative programmes",
      "Disability-access upgrades",
      "Livelihood centres",
      "Vocational facilities",
      "Financial-inclusion programmes",
    ],
    large: [
      "Multi-community livelihood programmes",
      "Women's enterprise-development centres",
      "Disability-inclusion programmes",
      "Social-enterprise centres",
      "Economic-inclusion initiatives",
      "Community care and support facilities",
    ],
  },
  "Sports & Youth Development": {
    small: [
      "Sports equipment",
      "Community tournaments",
      "Rehabilitation of playing fields",
      "Youth clubs",
      "Coaching clinics",
      "School sports support",
    ],
    medium: [
      "Community sports courts",
      "Playing-field upgrades",
      "Youth recreation centres",
      "Mini-stadium rehabilitation",
      "Sports-development programmes",
      "Community fitness facilities",
    ],
    large: [
      "Sports complexes",
      "Multipurpose youth centres",
      "Constituency sports academies",
      "Major playing-field development",
      "Recreation centres",
      "Youth-development campuses",
    ],
  },
  "Community & Civic Infrastructure": {
    small: [
      "Town-hall repairs",
      "Community seating",
      "Noticeboards",
      "Minor library rehabilitation",
      "Public-space improvements",
      "Community meeting facilities",
    ],
    medium: [
      "Community centres",
      "Multipurpose halls",
      "Public libraries",
      "Community-resource centres",
      "Meeting/training facilities",
      "Civic information centres",
    ],
    large: [
      "Civic centres",
      "Constituency resource centres",
      "Multipurpose community complexes",
      "Public libraries and learning centres",
      "Community-development hubs",
      "Public training and conference facilities",
    ],
  },
  "Transport & Public Access": {
    small: [
      "Bus-stop shelters",
      "Pedestrian crossings",
      "Directional signage",
      "Road markings",
      "Access ramps",
      "Waiting areas",
    ],
    medium: [
      "Motor-park rehabilitation",
      "Community transport terminals",
      "Access-road improvements",
      "Pedestrian facilities",
      "Public-transport waiting areas",
      "Traffic-management improvements",
    ],
    large: [
      "Major motor parks",
      "Transport interchanges",
      "Strategic transport-corridor improvements",
      "Integrated community terminals",
      "Multi-community mobility projects",
      "Public-transport infrastructure",
    ],
  },
  "Culture, Tourism & Heritage": {
    small: [
      "Heritage documentation",
      "Cultural festivals",
      "Tourism signage",
      "Community arts programmes",
      "Heritage clean-up",
      "Local-history documentation",
    ],
    medium: [
      "Heritage-site rehabilitation",
      "Community museums",
      "Creative hubs",
      "Cultural centres",
      "Tourism-support infrastructure",
      "Heritage trails",
    ],
    large: [
      "Tourism-destination development",
      "Cultural centres",
      "Heritage corridors",
      "Major heritage-site restoration",
      "Creative-economy hubs",
      "Tourism-support infrastructure",
    ],
  },
  "Social Protection": {
    small: [
      "Emergency food support",
      "School-support packages",
      "Support for elderly persons",
      "Disability support",
      "Emergency household assistance",
      "Vulnerable-family referrals",
    ],
    medium: [
      "Structured vulnerable-household programmes",
      "Livelihood support schemes",
      "Elderly-support programmes",
      "Disability-inclusion interventions",
      "School-support programmes",
      "Household economic-strengthening initiatives",
    ],
    large: [
      "Constituency-wide livelihood programme",
      "Economic-inclusion programme",
      "Integrated vulnerable-household support",
      "Disability-support programme",
      "Youth/women economic-support programme",
      "Social-assistance management platform",
    ],
  },
  "Community Data & Planning": {
    small: [
      "Community needs assessment",
      "Asset mapping",
      "Community register",
      "School/health-facility mapping",
      "Basic GIS database",
      "Community project inventory",
    ],
    medium: [
      "Ward development database",
      "GIS mapping of public services",
      "Infrastructure inventory",
      "Community-needs database",
      "Project-monitoring dashboard",
      "Ward development profile",
    ],
    large: [
      "Constituency GIS platform",
      "Development-information system",
      "Comprehensive asset database",
      "Project-tracking dashboard",
      "Community-needs and beneficiary database",
      "Spatial decision-support system",
    ],
  },
};

export const SECTORS = Object.keys(FRAMEWORK);

/** The six suggested projects for a sector at a scale. */
export function projectsFor(sector, scale) {
  return FRAMEWORK[sector]?.[scale] || [];
}

/** Is this a project the framework lists, rather than a free-text one? */
export function isFrameworkProject(sector, scale, name) {
  return projectsFor(sector, scale).includes(name);
}
