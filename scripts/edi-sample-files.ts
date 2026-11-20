/**
 * Writes SAMPLE files "from a trading partner", ready to upload in Supply Chain → EDI → Files → Upload, so a person can learn and
 * test every inbound path with their own IDs, order numbers and part numbers. Nothing here touches a database.
 *
 *   npx tsx scripts/edi-sample-files.ts [options]
 *
 *   --ours   <id>     OUR interchange ID as set on the partner ("Our interchange ID")            default PRIMETEST
 *   --theirs <id>     THEIR interchange ID as set on the partner ("Their interchange ID")        default TESTPARTNER
 *   --po     <no>     OUR purchase order number (for the 855, 856 and 810 a SUPPLIER sends)      default PO-0001
 *   --unit   <code>   the X12 unit of that PO line (KG, CA, EA, ...)                              default KG
 *   --qty    <n>      the quantity on that PO line, in that unit                                  default 100
 *   --price  <n>      the unit price per that unit                                                default 2.5
 *   --item   <code>   OUR item code on that PO line (optional; a mismatch is refused)
 *   --customer-po <no>  THEIR order number (for the 850 a CUSTOMER sends)                         default CUST-PO-1001
 *   --their-part <c>  THEIR part number for the item they order (register it first)              default CUST-ITEM-1
 *   --their-qty <n> / --their-unit <u> / --their-price <p>   what the customer orders             default 10 / KG / 12.5
 *   --our-control <n> the control number of OUR first outbound file to them (for the 997/999/TA1) default 1
 *   --version 004010|005010                                                                       default 004010
 *   --out <dir>       where to write                                                              default docs/edi-samples
 *   --start <n>       the first interchange control number used                                   default 9001
 *
 * Every file carries its own interchange control number (9001 upward): uploading the SAME file twice is deliberately ignored,
 * so to repeat a test run this again with --start <higher number>.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { interchange, interchangeBare, seg, type Envelope } from "../lib/edi/x12/envelope";

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const num = (n: string, d: number) => { const v = Number(arg(n, String(d))); if (!Number.isFinite(v)) throw new Error(`${n} must be a number`); return v; };

const ours = arg("--ours", "PRIMETEST"), theirs = arg("--theirs", "TESTPARTNER");
const po = arg("--po", "PO-0001"), unit = arg("--unit", "KG").toUpperCase(), qty = num("--qty", 100), price = num("--price", 2.5);
const item = arg("--item", "");
const customerPo = arg("--customer-po", "CUST-PO-1001"), theirPart = arg("--their-part", "CUST-ITEM-1");
const theirQty = num("--their-qty", 10), theirUnit = arg("--their-unit", "KG").toUpperCase(), theirPrice = num("--their-price", 12.5);
const ourControl = num("--our-control", 1);
const version = arg("--version", "004010") as "004010" | "005010";
const out = arg("--out", "docs/edi-samples");
let next = num("--start", 9001);

const d = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
const today = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const plus = (days: number) => { const t = new Date(d.getTime() + days * 86400000); return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`; };
const money = (n: number) => String(Math.round(n * 100));

// A file FROM the partner: THEIR ID is the sender, ours the receiver. Always a TEST interchange (ISA15 = T).
const env = (): Envelope => ({ version, test: true, senderQualifier: "ZZ", senderId: theirs, receiverQualifier: "ZZ", receiverId: ours,
  senderAppId: theirs, receiverAppId: ours, controlNo: next++, now: { date: today, time: "0900" } });

const files: { name: string; what: string; body: string }[] = [];
const add = (name: string, what: string, body: string) => files.push({ name, what, body });

// ---- A CUSTOMER orders from us (850) ---------------------------------------------------------------------------------------
const f850 = (partNo: string, orderNo: string) => interchange(env(), "PO", "850", [
  seg("BEG", "00", "SA", orderNo, "", today), seg("DTM", "002", plus(14)),
  seg("PO1", 1, theirQty, theirUnit, theirPrice, "", "BP", partNo), seg("CTT", 1)]);
add("850_customer_order.x12", `Their order ${customerPo}: ${theirQty} ${theirUnit} of their part ${theirPart} at ${theirPrice}. Becomes a Sales Order (a document only).`, f850(theirPart, customerPo));
add("850_customer_order_UNKNOWN_PART.x12", "The same kind of order with a part number you never registered. The WHOLE order is refused and goes to review: the safety rule.", f850("NOT-REGISTERED-999", `${customerPo}-X`));

// ---- A SUPPLIER answers our purchase order ----------------------------------------------------------------------------------
add("855_supplier_accepts.x12", `The supplier accepts ${po} as sent. Records a confirmation on the order.`, interchange(env(), "PR", "855", [
  seg("BAK", "00", "AD", po, today), seg("PO1", 1, qty, unit, price), seg("ACK", "IA", qty, unit), seg("CTT", 1)]));
add("855_supplier_changes_qty_and_date.x12", `The supplier proposes ${Math.floor(qty * 0.8)} ${unit} on a later date. Stored as a PROPOSAL for a person to decide: never applied by itself.`, interchange(env(), "PR", "855", [
  seg("BAK", "00", "AC", po, today), seg("PO1", 1, qty, unit, price), seg("ACK", "IQ", Math.floor(qty * 0.8), unit, "068", plus(21)), seg("CTT", 1)]));
add("856_supplier_ship_notice.x12", `The supplier advises ${qty} ${unit} of ${po} on a pallet (with a batch and dates). Becomes an expected delivery: stock is NOT received.`, interchange(env(), "SH", "856", [
  seg("BSN", "00", "ASN-SAMPLE-1", today, "0900"),
  seg("HL", 1, "", "S", 1), seg("TD5", "B", "2", "DHLX", "M", "Sample Freight"), seg("REF", "CN", "TRACK-SAMPLE-1"), seg("DTM", "011", today), seg("DTM", "017", plus(3)),
  seg("HL", 2, 1, "O", 1), seg("PRF", po),
  seg("HL", 3, 2, "T", 1), seg("MAN", "GM", "354123450000000014"),
  seg("HL", 4, 3, "I", 0), seg("LIN", "1", ...(item ? ["BP", item] : []), "LT", "BATCH-SAMPLE-1"), seg("SN1", "", qty, unit),
  seg("DTM", "094", today), seg("DTM", "036", plus(365)),
  seg("CTT", 4)]));
add("810_supplier_invoice.x12", `The supplier invoices ${qty} ${unit} of ${po} at ${price}. Matched to your RECEIPT and proposed as a bill: a person presses Create bill. Receive the goods first.`, interchange(env(), "IN", "810", [
  seg("BIG", today, "INV-SAMPLE-1", "", po), seg("CUR", "SE", "EUR"), seg("ITD", "01", "3", "", "", "", "", "30"),
  seg("IT1", 1, qty, unit, price, "", ...(item ? ["BP", item] : [])),
  seg("TDS", money(qty * price)), seg("CTT", 1)]));

// ---- Acknowledgements of OUR files (the partner confirms it read them) -----------------------------------------------------
add("997_from_partner_accepted.x12", `Their 997 for our group ${ourControl}: accepted. Marks our file "accepted by partner".`, interchange(env(), "FA", "997", [
  seg("AK1", "PO", ourControl), seg("AK2", "850", "0001"), seg("AK5", "A"), seg("AK9", "A", 1, 1, 1)]));
add("999_from_partner_rejected.x12", `Their 999 for our group ${ourControl}: REJECTED. Marks our file rejected and puts this file in review.`, interchange(env(), "FA", "999", [
  seg("AK1", "PO", ourControl, version), seg("AK2", "850", "0001"), seg("IK5", "R", "5"), seg("AK9", "R", 1, 1, 0)]));
add("TA1_from_partner_accepted.x12", `Their TA1 for our interchange ${ourControl}: they read the envelope.`, interchangeBare(env(), [
  seg("TA1", String(ourControl).padStart(9, "0"), today.slice(2), "0900", "A", "000")]));
add("TA1_from_partner_rejected_duplicate.x12", `Their TA1 for our interchange ${ourControl}: rejected, note 025 (duplicate control number). Shown in words.`, interchangeBare(env(), [
  seg("TA1", String(ourControl).padStart(9, "0"), today.slice(2), "0900", "R", "025")]));

mkdirSync(out, { recursive: true });
for (const f of files) writeFileSync(join(out, f.name), f.body);
const readme = ["# Sample EDI files from a trading partner", "",
  `Made with: ours=${ours} theirs=${theirs} po=${po} unit=${unit} qty=${qty} price=${price} customer-po=${customerPo} their-part=${theirPart} our-control=${ourControl} version=${version}`, "",
  "Upload each in **Supply Chain → EDI → Files → Upload a received file**. They are TEST files (ISA15 = T).", "",
  ...files.map(f => `- \`${f.name}\`: ${f.what}`), "",
  "Each file has its own control number; the same file uploaded twice is ignored on purpose. To run a test again, make the files again with a higher `--start`.", ""].join("\n");
writeFileSync(join(out, "README.md"), readme);
console.log(`wrote ${files.length} files to ${out}`);
for (const f of files) console.log(`  ${f.name}`);
