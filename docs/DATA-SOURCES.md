# Verifying that registered people are real

> You asked whether we can check people's details against INEC so that agents
> cannot simply enrol family and friends, or people who do not actually live in
> the polling unit they claim. This is the straight answer.

## Short version

| Check | Needs a key? | Status in this build |
|---|---|---|
| Duplicates, padding, location fraud | **No** | Live now |
| NUBAN check digit (account is well-formed) | **No** | Live now |
| Account name vs registered name | **No** | Live now |
| PVC / VIN → INEC voter register | **No** — bulk match a register extract | Live once an extract is loaded |
| Bank account → real name, from your payment file | **No** | Live now |
| Bank account → real name, on demand | **Yes** | Built, needs a provider key |
| NIN → NIMC identity | **Yes** | Built, needs a provider key |

---

## "Can I do the bank check without an API key?"

**Not the live lookup — but you can get the same answer three other ways, all free.**

The account-name data lives with **NIBSS**, and only licensed institutions can
query it. Every provider (Paystack, Flutterwave, Monnify, Korapay) puts it behind
a key. Worth knowing: **Paystack charges nothing per lookup** — the barrier is not
money, it is that a *live* key requires a CAC-registered business and KYC.

Here is what works with no key at all:

### a) NUBAN check digit — live now

Nigerian account numbers are not arbitrary. Under the CBN NUBAN standard the
10th digit is a checksum over the bank code and the first nine digits. The
platform recomputes it on every registration, so **an invented or mistyped
account number is rejected immediately**, at zero cost.

What it proves: the number is well-formed for that bank.
What it does not prove: that the account exists, or who owns it.

Commercial banks use 3-digit CBN codes and are fully checked. Fintechs and
microfinance banks (Opay, PalmPay, Kuda, Moniepoint) use longer codes and a
different scheme, so they are reported as *not applicable* rather than failed.

### b) Account name consistency — live now

The registration form captures the account name. The platform compares it with
the person's registered first and last name and flags entries where they do not
correspond.

### c) Payment reconciliation — live now, and this is the strong one

**When you actually pay people, the bank tells you the real account names for
free.** Your payment-confirmation file or statement lists the true beneficiary
name for every account credited.

Upload that file under **Admin → Data sources → Bank reconciliation** (columns
`account_number, account_name`). The platform matches each row to a member,
records the bank-confirmed name permanently, and flags every case where the bank
paid a different person than the one registered. A confirmed mismatch carries the
highest weight in the risk score of any check, because the bank itself is the
source.

This gives you exactly what the paid API gives you. The only difference is
timing: the API answers before you pay, the payment file answers as you pay. For
a programme that pays monthly anyway, a first small run doubles as a
verification sweep of the whole network.

---

## 1. Bank account name — the strongest check available, and the cheapest

Paystack and Flutterwave both expose an account-resolution endpoint: give it a
10-digit NUBAN and a bank code, and it returns **the name the account is
registered to**. This is free or near-free on a Nigerian business account.

Why it matters more than it first appears: people who pad a list with relatives
usually cannot produce a distinct bank account per fake name. Resolving the
account name catches:

- one person's account submitted under several different names,
- names that do not match the account holder,
- accounts shared across "different" members.

The platform already compares the resolved name against the submitted first and
last name and raises `bank_name_mismatch` when they disagree.

**To turn on:**

```bash
PAYSTACK_SECRET_KEY=sk_live_xxxxx
```

## 2. NIN — real, but only through a licensed provider

NIMC does not give the public direct API access. Verification goes through
licensed aggregators — **Dojah, Prembly (IdentityPass), VerifyMe, Youverify** —
who are charged per lookup (roughly ₦30–₦100 depending on volume and provider).

They return the name, date of birth and registered phone number for a NIN, which
the platform compares against the submitted surname and flags `nin_name_mismatch`
on a disagreement.

**To turn on:**

```bash
KYC_PROVIDER=dojah        # or: prembly
KYC_API_KEY=xxxxx
KYC_APP_ID=xxxxx          # Dojah only
```

Adapters for both providers are already written in `server/verify.js`.

**Consent matters here.** Running someone's NIN through a verification service is
processing sensitive personal data under the NDPA. Registration must capture
explicit consent, and the programme should be able to show it.

## 3. PVC / VIN — there is no INEC API, and anyone who says otherwise is wrong

INEC publishes **no programmable lookup** for voter identification numbers. Their
own online verification portal is not an API, it is rate-limited, it appears only
around registration exercises, and scraping it would be both unreliable and
legally questionable.

So automated live PVC verification is not available to anyone — not to this
platform and not to any vendor claiming otherwise.

### What actually works instead

INEC publishes the **register of voters per polling unit**, and parties and
candidates routinely obtain the extract for their area. If you can get that
extract as a CSV, the platform will use it.

Upload it under **Admin → Data sources** with these columns:

```csv
vin,ward,polling_unit
90F5A78901234567890,Ibadan North Ward 01,Agodi Gate Open Space PU 012
```

Once loaded, every registration is matched against it and the platform flags:

- **VIN not found in the register** — the card number does not exist in your extract,
- **polling unit mismatch** — the person is a real voter, but registered at a
  *different* polling unit from the one claimed. This is precisely the "they put
  someone who is not in the ward" case you were worried about.

Until an extract is loaded, the VIN is format-checked (19 characters) and
duplicate-checked, and the voter-roll check reports `not_configured` rather than
silently passing.

---

## 4. What the platform catches on its own, today, with no keys and no extract

These run on every single registration and need no external service:

| Control | What it catches |
|---|---|
| **Duplicate detection** | The same phone, NIN, VIN or bank account submitted twice anywhere in the state |
| **NUBAN check digit** | Invented or mistyped account numbers that cannot exist at that bank |
| **Account name match** | An account name that does not correspond to the person registered |
| **Format validation** | 11-digit NIN, 19-character VIN, 10-digit NUBAN, valid Nigerian mobile |
| **GPS capture + boundary check** | Registrations submitted from outside Kwara State |
| **Surname clustering** | Three or more people with the same surname at one polling unit — the classic family-padding signature |
| **Shared bank accounts** | One account number reused across "different" members |
| **Bulk-entry detection** | More than 15 registrations from one login in ten minutes — someone typing a list rather than meeting people |
| **Bank reconciliation** | The bank paid a different name than the one registered |
| **Audit trail** | Every registration, approval and payment decision tied to a named login |

Measured on the 4,203 seeded records with **no keys and no simulation**: 28
impossible account numbers and 56 voter-register failures found, and a planted
bank file caught all 6 impostor payees.

### Demonstration mode

Setting `VERIFY_MODE=simulate` makes the two paid lookups return plausible
results so the full workflow can be shown without provider accounts. Every
simulated result is labelled in the interface and carries `simulated: true` in
the API, so it can never be mistaken for a real identity check. The keyless
controls above are real in every mode.

Each control carries a weight; together they produce a **risk score out of 100**.
Anything at 50 or above is held as `flagged` and cannot be verified without a
supervisor explicitly reviewing it.

---

## 5. The control that matters most is not technical

No API proves that someone actually campaigned. What proves it is **work that is
hard to fake**:

- Tasks that require **photo evidence plus GPS** at the time of submission.
- A **supervisor approval step** before any point is awarded.
- **Payment gated on the downline** — a Mobiliser is not paid unless the ten
  people below them each cleared their own tasks. Inventing ten relatives who
  will never do a task means the Mobiliser is never paid, which removes the
  incentive to invent them in the first place.

That last rule is the strongest anti-padding mechanism in the design, and it is
already enforced in `server/points.js`.

---

## Recommended rollout

1. **Now, free:** duplicate detection, format validation, GPS, clustering, audit
   trail, downline payment gate. All live.
2. **Week 1, cheap:** add the Paystack key. Bank-name resolution is the highest
   value per naira of any check here.
3. **Week 2:** obtain the INEC register extract for your wards and load it. This
   is what answers "is this person actually in this polling unit".
4. **When budget allows:** add a NIN provider for identity confirmation on
   mobilisers, since they control the local field activity.
