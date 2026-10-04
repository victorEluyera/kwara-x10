// LGA-level electoral scope. Sources and unresolved ward splits: docs/KWARA-ADAPTATION.md.
export const SENATORIAL = {
  'Kwara Central': ['Asa', 'Ilorin East', 'Ilorin South', 'Ilorin West'],
  'Kwara North': ['Baruten', 'Edu', 'Kaiama', 'Moro', 'Patigi'],
  'Kwara South': ['Ekiti', 'Ifelodun', 'Irepodun', 'Isin', 'Offa', 'Oke Ero', 'Oyun'],
};
export const FEDERAL = {
  'Asa/Ilorin West': ['Asa', 'Ilorin West'],
  'Baruten/Kaiama': ['Baruten', 'Kaiama'],
  'Edu/Moro/Patigi': ['Edu', 'Moro', 'Patigi'],
  'Ekiti/Isin/Irepodun/Oke Ero': ['Ekiti', 'Isin', 'Irepodun', 'Oke Ero'],
  'Ilorin East/Ilorin South': ['Ilorin East', 'Ilorin South'],
  'Ifelodun/Offa/Oyun': ['Ifelodun', 'Offa', 'Oyun'],
};
// Official seat names from the Kwara House of Assembly. Whole-LGA seats can
// be scoped now; split seats require an authoritative ward-to-seat mapping.
export const STATE_CONST = {
  Afon: ['Asa'], 'Owode/Onire': ['Asa'],
  'Ilesha/Gwanara': ['Baruten'], 'Okuta/Yashikira': ['Baruten'],
  Edu: ['Edu'], Ekiti: ['Ekiti'], Omupo: ['Ifelodun'], 'Share/Oke-Ode': ['Ifelodun'],
  'Ilorin East': ['Ilorin East'], 'Ilorin South': ['Ilorin South'],
  'Ilorin Central': ['Ilorin West'], 'Ilorin North-West': ['Ilorin West'],
  Irepodun: ['Irepodun'], Isin: ['Isin'],
  'Gwanabe/Gweria/Bani/Adena': ['Kaiama'], 'Kaiama/Kemanji/Wajibe': ['Kaiama'],
  'Lanwa/Ejidongari': ['Moro'], 'Oloru/Malete/Ipaiye': ['Moro'],
  'Balogun/Ojomu': ['Offa'], 'Shawo/Essa': ['Offa'],
  'Oke-Ero': ['Oke Ero'], 'Oke-Ogun': ['Oyun'], 'Odo-Ogun': ['Oyun'], Patigi: ['Patigi'],
};
