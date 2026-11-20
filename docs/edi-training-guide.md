# EDI in Prime Accountax: understand it, test it, teach it

Written for someone who has never used EDI. Read Parts 1 to 4 (about 20 minutes) and you can explain the whole system. Do Part 6
(about 90 minutes) and you have used every part of it. Part 8 is the outline for teaching it to others.

---

## Part 1. What EDI is, in plain words

**EDI is trading by form instead of by email.** When a customer orders from you, they normally send a PDF or an email and
someone retypes it. With EDI the customer's system produces a small structured text file instead, and your system reads it
without retyping. The same goes for your order confirmation, your shipping notice and your invoice, in the other direction.

Each kind of form has a **number**, set by an international standard (called X12). You only need seven of them:

| Number | What it is | Who sends it | In everyday words |
|---|---|---|---|
| **850** | Purchase order | the buyer | "Here is my order." |
| **855** | Purchase order acknowledgement | the seller | "Got your order, this is what I can do." |
| **856** | Advance ship notice (ASN) | the seller | "It is on its way: what, how much, on which pallets." |
| **810** | Invoice (also credit memo) | the seller | "Here is the bill." |
| **997** | Functional acknowledgement | whoever received a file | "I read your file." |
| **999** | The newer form of the 997 (5010) | whoever received a file | "I read your file." |
| **TA1** | Interchange acknowledgement | whoever received a file | "Your envelope arrived intact." |

**The one rule to remember: a file in never posts anything by itself. A person always decides.** A customer's 850 creates a
Sales Order *document*. It does not ship, invoice or touch stock. A supplier's 810 creates a *proposal* for a bill. It
does not post the bill. You press the button.

**What our version does and does not do today.** Files are made and read inside the app, but **delivery is by hand**: you
download a file and send it to the partner yourself (their portal, email, SFTP), and you upload what they send you. There
is no automatic connection to a partner's system yet. This is deliberate: it is the cheapest honest start, and every
file is kept so you can see exactly what was exchanged.

---

## Part 2. The four ideas that make the system make sense

1. **A partner** is one company you trade with by EDI, with a small profile: their ID, our ID, test or live, which
   documents they get, and their rules (do they need our part number on every line, which unit codes they use). One partner
   is either a *supplier* (you buy) or a *customer* (you sell).
2. **A file** is one thing sent or received. Every file is stored with its status, so there is a full history. You find them
   in **Supply Chain → EDI → Files**.
3. **Documents come in pairs and chains.** Buying: your 850 goes out; their 855, 856 and 810 come back. Selling: their 850
   comes in; your 855, 856 and 810 go out. Each one moves your order one step forward.
4. **Review is a feature, not an error.** When the system is not sure, it stops and tells you why, in words, instead of
   guessing. A file in *needs review* is the system being careful. Most of your day-to-day with EDI is reading a
   review reason and fixing the cause (a missing part number, a wrong unit).

### The envelope (why IDs matter)

Every file is wrapped in an envelope with **who it is from** and **who it is to**. The partner's profile must match it
exactly: the file's *sender* must be the partner's "Their interchange ID", and its *receiver* our "Our interchange ID".
Otherwise the file is refused with a message naming the IDs. Each file also has a **control number**, a counter that
never repeats. That is how a repeated upload of the same file is recognised and ignored, and how an acknowledgement says
which of your files it is about.

**Test or live?** Every file says whether it is a test (`ISA15 = T`). A partner set to *test* exchanges test files.
Always start in test. A test file from a partner set to *live* is stored and ignored. It never applies.

---

## Part 3. The two journeys

### Buying (we are the buyer)

| Step | What happens | Who acts |
|---|---|---|
| 1 | You create a Purchase Order as usual. | person |
| 2 | **Send by EDI** on the PO row makes the 850. The system checks it first and names anything missing. | person |
| 3 | You download it, deliver it to the supplier, and press **Mark sent**. | person |
| 4 | Their **855** arrives (upload). A confirmation is recorded on the PO. A change (quantity or date) is stored as a **proposal**, never applied by itself. | system, then person decides |
| 5 | Their **856** arrives. It becomes an **expected delivery**. Stock is **not** received. | system |
| 6 | The goods arrive. You receive them in **Receiving** (the expected delivery pre-fills what to count). | person |
| 7 | Their **810** arrives. It is matched to your receipt and shown as a **proposed bill**. Press **Create bill** to post it. | system, then person |

### Selling (we are the seller)

| Step | What happens | Who acts |
|---|---|---|
| 1 | Their **850** arrives (upload). It becomes a **Sales Order** (document only), with their PO number on it. | system |
| 2 | You review and **Confirm** the Sales Order. | person |
| 3 | **Acknowledge by EDI** on the order makes our **855** (what we promise). | person |
| 4 | You ship it as usual in **Shipping**. If you want pallet barcodes, **Pack shipment**, then **Print labels**. | person |
| 5 | **Advise by EDI** on the shipment makes our **856**, with pallets, cartons, batches and weights. | person |
| 6 | You create the invoice from the shipments. On the invoice, **Send by EDI** makes our **810**. | person |
| 7 | A credit note has the same **Send by EDI** and goes as a credit memo. | person |

---

## Part 4. The safety rules (the part to explain to nervous people)

1. **Nothing posts by itself.** Files create documents and proposals. People post.
2. **It never guesses.** One line it cannot place (unknown part number, wrong unit, no price) refuses the *whole*
   order, and nothing is created. A half order is a wrong order.
3. **Never twice.** The same customer order number from the same customer is never created twice. The same file uploaded twice
   is ignored.
4. **Test stays test.** Test files never touch live data.
5. **A person fixes the cause.** The review reason says what to fix. Then you send a new file or process it again.
6. **Everything is kept.** Every file is stored exactly as exchanged and can be downloaded again.

---

## Part 5. Setting up for a test (once, about 30 minutes)

Do this in a **test company**, never your real one first.

1. **Turn the module on.** A platform admin opens the company in the admin portal and ticks **EDI** in the Modules card
   (it also needs Manufacturing for ship notices and receiving). You should now see **EDI** under Supply Chain.
2. **Company details.** In Settings → Company, fill in the address. Optionally add a GLN, and a **GS1 company prefix**
   (needed only if you want printed pallet barcodes, called SSCC).
3. **Make test data.** One customer ("EDI Test Customer"), one supplier ("EDI Test Supplier"), and one item you both buy
   and sell, with base unit **kg** (so the EDI unit code is `KG`). Make sure the item has its accounts set, as always.
4. **Link the supplier to the item** (Suppliers panel on the item). Purchasing from an unlinked supplier is refused by
   design, and EDI does not bypass it.
5. **Register the customer's part number.** Open the customer, choose **Import their part numbers**, paste
   `EDI Test Rice<TAB>CUST-ITEM-1`, press **Check the list**, then **Save the matched lines**. (Or add it one at a time in the item's
   *Customer part numbers* panel.) This is the key that lets their orders be recognised.
6. **Add two partners** in EDI → Partners → **New partner**:
   - Customer: *Partner is a* **Customer**, our ID `PRIMETEST`, their ID `TESTPARTNER`, ID qualifiers `ZZ`, mode **Test**,
     tick 997, 999 and TA1.
   - Supplier: *Partner is a* **Supplier**, our ID `PRIMETEST`, their ID `TESTSUPPLIER`, qualifiers `ZZ`, mode **Test**.
7. **Make the sample files** (they use your IDs and numbers). In a terminal in the project folder:

```powershell
npx tsx scripts/edi-sample-files.ts --theirs TESTPARTNER --their-part CUST-ITEM-1 --their-unit KG --their-qty 10 --their-price 12.5
```

   You get ten files in `docs/edi-samples/` and a README that says what each one does. You will make a second set for the
   supplier side in Part 6B, once you know your PO number.

---

## Part 6. The hands-on lab (about 90 minutes)

After each step is a line starting **You should see**. If you do not, stop and re-read the step. That is the learning.

### A. Selling: a customer's order to our invoice

1. **Upload their order.** EDI → Files → **Upload a received file** → `850_customer_order.x12`.
   *You should see:* the file in the list and a result line saying a Sales Order was created from `CUST-PO-1001`. The status
   reads *applied*. If their price (12.50) is more than 1% away from your item's list price, it reads *needs review* with a
   note about the price. The order is still created, and a person looks at the price.
2. Open **Accounting → Sales Orders**. *You should see* a new order for your test customer with `CUST-PO-1001` as their PO
   number and your item at 10 kg.
3. **Confirm it** (the Confirm action on the order row).
4. **Acknowledge by EDI** on that row. *You should see* a drawer that checks the order and lets you generate the 855.
   Generate it, **Download the file**, open it in Notepad (read Part 7 alongside), then press **Mark sent**.
   *You should see* the file in EDI → Files with status *sent, not acknowledged yet*.
5. **Ship it.** You need stock of the item first (receive some without a PO, or use an opening balance). In **Shipping**,
   ship the order. Enter a **Carrier** and, optionally, a **Carrier code (SCAC)** such as `UPSN`.
6. **Pack shipment** (the package icon): make one pallet, enter its gross weight, and add the goods to it.
   *You should see* an SSCC number on the pallet. **Print labels** opens a 4 × 6 inch label with a barcode.
7. **Advise by EDI** on the shipment. Generate, download, read it. *You should see* the pallet, its SSCC, the weight and the
   carrier in the file.
8. Create the **invoice from the shipment**, open the invoice, press **Send by EDI**. Generate, download, read it.
   *You should see* their PO number and their line number on the invoice file.
9. Optional: make a **credit note** for part of it and press **Send by EDI** on it. *You should see* a credit memo file.

### B. Buying: our order to their invoice

1. Create a **Purchase Order** to the test supplier for your item (for example 100 kg at 2.50). Note its number.
2. On the PO row choose **Send by EDI**. Generate, download, **Mark sent**.
3. Make the supplier's sample files, using your real PO number:

```powershell
npx tsx scripts/edi-sample-files.ts --theirs TESTSUPPLIER --po PO-0001 --unit KG --qty 100 --price 2.5 --out docs/edi-samples-supplier --start 9101
```

4. Upload `855_supplier_accepts.x12`. *You should see* the PO marked **Confirmed**.
5. Upload `855_supplier_changes_qty_and_date.x12`. *You should see* **Revision proposed**, and the order not changed until you
   accept the proposal. This is rule 1 in action.
6. Upload `856_supplier_ship_notice.x12`. In **Receiving**, open **Expected deliveries**. *You should see* a delivery with
   the batch and the pallet. Your stock has **not** changed.
7. **Receive the goods** against the PO (the expected delivery pre-fills the lines). *You should see* stock go up now.
8. Upload `810_supplier_invoice.x12`. Open the file in EDI → Files. *You should see* a **proposed bill** matched to your
   receipt, with a **Create bill** button. Press it. *You should see* a bill number, and the receipt marked billed.

### C. Acknowledgements: "did they read our file?"

1. In EDI → Files, note the **control number** of one of your outbound files (for example 1).
2. Make the acknowledgement samples for it: `npx tsx scripts/edi-sample-files.ts --theirs TESTPARTNER --our-control 1 --start 9201`.
3. Upload `997_from_partner_accepted.x12`. *You should see* your file change to **accepted by partner**.
4. Upload `TA1_from_partner_rejected_duplicate.x12`. *You should see* your file marked **rejected** with the reason in words
   (a duplicate control number), and the uploaded file in *needs review*.
5. Upload `TA1_from_partner_accepted.x12` afterwards. *You should see* the rejection **stay**: a later "OK" never hides a "not OK".
6. Open any file you *received* and press **Make our 999 for this file** and **Make our TA1 for this file**. *You should see* two
   small files you can download (or "already made", if the partner is set to make them automatically). An acknowledgement is never acknowledged: try it on a 997 you received, and read the refusal.

### D. Break it on purpose (this is the best way to learn the rules)

| Try this | You should see |
|---|---|
| Upload `850_customer_order_UNKNOWN_PART.x12` | Status *needs review*, reason "no match" for the part number, **no Sales Order created**. |
| Upload the same 850 file a second time | Ignored: "already received". No second order. |
| Make a new 850 with the same customer PO number but another file (`--start` higher) | Not created again: same customer + same PO number. |
| Set a partner to **Live**, then upload a test file | Stored and ignored. Nothing applies. |
| Create a Sales Order **by hand** (no customer PO number), confirm it, then **Acknowledge by EDI** | Refused, saying the order has no customer PO number. |
| Edit an invoice's amounts after it was made, then **Send by EDI** | Refused: the lines no longer add up. Send it by hand. |
| Upload the 810 *before* receiving the goods | No proposal: "nothing received is waiting to be billed". |

---

## Part 7. Reading a raw file (so it is not magic)

An X12 file is lines ending in `~`. Each line is a **segment**: a short name, then values separated by `*`.

```
ISA*00*          *00*          *ZZ*TESTPARTNER    *ZZ*PRIMETEST      *261120*0900*U*00401*000009001*0*T*>~   envelope: FROM TESTPARTNER, TO PRIMETEST, control 9001, T = test
GS*PO*TESTPARTNER*PRIMETEST*20261120*0900*9001*X*004010~                                                  group: a batch of purchase orders
ST*850*0001~                                                                                                one document starts: an 850
BEG*00*SA*CUST-PO-1001**20261120~                                                                          order number CUST-PO-1001, dated 20 Nov 2026
DTM*002*20261204~                                                                                          they want it by 4 Dec 2026
PO1*1*10*KG*12.5**BP*CUST-ITEM-1~                                                                          line 1: 10 KG at 12.50, their part number CUST-ITEM-1
CTT*1~                                                                                                      1 line in total
SE*6*0001~  GE*1*9001~  IEA*1*000009001~                                                                    everything closes, with counts that must add up
```

If the counts or control numbers do not add up, the file is refused, never half-read. Other letters you will meet:
`BP` buyer's part number, `VP` vendor's part number, `UP` a barcode number (GTIN), `LT` batch, `MAN*GM` a pallet barcode
(SSCC), `TD5` the carrier, `TDS` the invoice total **in cents**, `SAC` a charge or discount, `TXI` tax.

---

## Part 8. Teaching it to others

### A 45-minute session

1. **10 min, the idea.** Part 1 and the two journeys in Part 3, drawn on a whiteboard. Stress rule 1 (a person decides).
2. **10 min, the vocabulary.** The table in Part 1 and the envelope IDs. Ask: "what do the two IDs have to match?"
3. **15 min, live demo.** Upload the 850 sample, show the Sales Order appear, then upload the unknown-part sample and show the
   refusal. The contrast teaches the safety model better than any slide.
4. **10 min, who does what.** Who sets up partners (an admin), who uploads and reviews (purchasing, sales), who sends
   (whoever owns the order).

### Five questions to check understanding

1. A customer's 850 arrives. Has any stock moved? *(No. A Sales Order document only.)*
2. One line on their order has a part number we do not know. What happens? *(The whole order goes to review, and nothing is created.)*
3. The supplier's 855 proposes less than we ordered. Did our order change? *(No, a person decides.)*
4. We upload the same file twice. What happens? *(The second is ignored.)*
5. A file arrives from a partner set to Live, but it is marked test. *(Stored and ignored.)*

### Mistakes everyone makes

- **IDs swapped.** "Their interchange ID" must be what the *file* says it is *from*. The refusal message names both IDs.
- **No part number registered** for the customer, so their order is refused. Register it first.
- **Wrong unit.** The file's unit must be the unit the order line uses (`KG`, `CA`). Unit codes can be overridden per partner.
- **Receiving before the invoice.** An invoice only becomes a proposed bill against goods you have received.
- **Expecting delivery to be automatic.** It is by hand for now: download, send, mark sent.

---

## Part 9. What it does NOT do yet (be honest with learners)

- **No automatic delivery** to or from partners (no SFTP, AS2 or portal link). Upload and download by hand.
- **EDIFACT is not supported**, only X12.
- **Order changes** (an 860 from a customer) are not read. A change goes to review.
- **The detailed layout of each partner's files varies.** What we send is the common shape. Each partner's own guide
  may ask for different segments, codes or signs (for example some want negative amounts on a credit memo). Testing with a
  real partner is the only way to be sure, so keep them in test mode until both sides agree.
- **Nothing has been tested with a real partner's system yet.** The samples prove our own reading and writing, not theirs.

## Quick reference: where things are

| I want to... | Go to |
|---|---|
| See every file, upload one | Supply Chain → EDI → Files |
| Add or change a partner | Supply Chain → EDI → Partners |
| Send a purchase order | Purchase Orders list → **Send by EDI** |
| Answer a customer's order | Sales Orders list → **Acknowledge by EDI** |
| Send a ship notice, print pallet labels | Shipping → **Advise by EDI**, **Pack shipment**, **Print labels** |
| Send an invoice or credit note | The invoice or credit note → **Send by EDI** |
| Register a customer's part numbers | Customer → **Import their part numbers** (or the item's Customer part numbers) |
| Check an expected delivery | Receiving → Expected deliveries |
