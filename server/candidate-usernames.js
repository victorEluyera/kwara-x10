// Username generation for candidate logins, shared by the seeder and the
// printable credential sheet.
//
// These MUST agree: if the sheet computed usernames separately and the two
// drifted, the campaign office would hand candidates logins that do not
// exist. One implementation, imported by both.
//
// Format: PREFIX-FIRSTNAME-NN, numbered within each prefix group.
//   GOV-SHARAFADEEN-01, SEN-YUNUS-01, FH-AKEEM-01, SH-ABIOLA-01

/** Strip a first name down to plain A-Z. */
function nameKey(firstName) {
  return String(firstName || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z]/g, '');
}

/**
 * Attach a username to every candidate, numbering restarts per prefix.
 * Returns a new array; the input is not modified.
 */
export function withUsernames(roster) {
  const seen = new Map();
  return roster.map((candidate) => {
    const n = (seen.get(candidate.prefix) || 0) + 1;
    seen.set(candidate.prefix, n);
    return {
      ...candidate,
      username: [candidate.prefix, nameKey(candidate.first_name),
                 String(n).padStart(2, '0')].join('-'),
    };
  });
}
