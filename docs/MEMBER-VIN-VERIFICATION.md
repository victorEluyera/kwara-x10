# Member VIN verification

Members are retained. The member interface uses VIN/location results and polling-unit availability, replacing approval badges and decisions. Matching uses VIN, LGA, ward and polling unit; names are not a verification requirement. Ward and polling-unit numbers are resolved using official INEC codes, never alphabetical order.

The reference comes from the official locator at https://cvr.inecnigeria.org/pu, downloaded on 2026-09-30: 33 LGAs, 351 wards and 6,390 polling units. Bare numbers, `Unit 001`, `PU001`, full `30/LGA/WARD/PU` codes, punctuation-equivalent names, common primary-school abbreviations and substantial unique address fragments are supported. Codes must match the submitted LGA and ward. Generic/ambiguous addresses and conflicting code/name combinations remain unresolved. Duplicate official names have code suffixes so they stay distinct.

**With polling unit** and **No resolved polling unit** filters are independent of VIN results. An unverified VIN does not prevent an unambiguous submitted location from being mapped to the official directory. That mapping does not verify the VIN. The report records whether a location came from the supplied voter register or the submitted location matched to the INEC directory. Apply the new report after deployment to populate availability for existing members; later imports and edits also resolve recognised locations.

Prepare a report from an exported nominee list and one or more voter files:

```powershell
node server/verify-nominee-files.js nominees.csv output-directory Kwara.csv voter-register.xlsx
```

The source voter files must have `Voter ID number`, `LGA`, `Ward` and `Polling Unit` headings. The scanner streams the files and only keeps locations for VINs present in the nominee export. Repeated register rows with the same VIN and location are treated as the same match. Conflicting registered locations and repeated nominee VINs require review.

After deploying the updated application, open **Administration → Members** and choose `member-verification-updates.json` under **Voter verification**. Administrators can apply this report to existing records. The update is transactional: member IDs, codes, owners, VINs and locations must match the export, or the whole update is refused. Reapplying an unchanged report is supported. It never inserts or deletes nominees. Existing approval status, bank details, relationships and linked history are retained. Linked member accounts receive the corrected geographic scope.

For a unique VIN with a recognised real polling unit, the record receives the registered location. A `location_mismatch` label retains the comparison with the original submission even after correction. `verified` means the submitted location already matched. Missing VINs, unfound VINs and review cases keep their locations. Changes to a member through the edit form clear the previous verification result.

Use the Members verification filter to show matched submissions, corrected submissions, missing VINs, unfound VINs or review cases. The table shows submitted and registered locations and the assignment outcome. Member CSV exports include the verification status and details.

**Export issues for correction** downloads all issue records matching the current candidate, LGA, ward, search and verification filters, across all pages. The export includes the owning candidate, member ID/code, name, phone, VIN, submitted/current/registered location, the requested action and blank correction fields. Bank and NIN details are omitted from this correction report. Already assigned location mismatches request confirmation of the correction; they are distinguishable from unresolved records. Reports remain limited to the caller's member scope.

The supplied `Kwara_10X_Data_Form_with_LGA_Ward_Dropdowns.xlsx` is accepted: candidate/constituency preamble, namespace-prefixed workbook XML, `Voters VIN` heading and `Ward 01` format. Its BVN column is ignored because the member model has no BVN field; it is not treated as NIN.
